// TODO(developer): Set to client ID and API key from the Developer Console

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = "https://docs.googleapis.com/$discovery/rest?version=v1";
const DISCOVERY_DOC_2 =
  "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

// Authorization scopes required by the API; multiple scopes can be. Included, separated by spaces.
const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive",
  // 'https://www.googleapis.com/auth/drive.metadata.readonly'
].join(" ");

const REDIRECT_URI = "http://localhost:5500";

const secondsToReload = 15;
const secondsToPassImage = 5;
const maxRetries = 5;
const loadAll = true;
const nextPageToken = null;

let tokenClient;
let gapiInited = false;
let gisInited = false;

let accessToken = null;

// References to DOM elements
const navigationList = document.querySelector(".carousel__navigation-list");
const loginButton = document.getElementById("login-button");
const container = document.querySelector(".carousel__viewport");

const imagesIdList = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms * 1000));
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const tokenUrl = "https://oauth2.googleapis.com/token";

  const data = new URLSearchParams();
  data.append("code", code);
  data.append("client_id", CLIENT_ID);
  data.append("client_secret", CLIENT_SECRET);
  data.append("redirect_uri", REDIRECT_URI);
  data.append("grant_type", "authorization_code"); // This is for the exchange

  const response = await fetch(tokenUrl, {
    method: "POST",
    body: data,
  });

  const responseData = await response.json();

  if (response.ok) {
    const { access_token, refresh_token, expires_in } = responseData;
    console.log("Access Token:", access_token);
    console.log("Refresh Token:", refresh_token);
    console.log("Expires in:", expires_in);

    // Save tokens to localStorage or sessionStorage
    localStorage.setItem("access_token", access_token);
    localStorage.setItem("refresh_token", refresh_token);
  } else {
    console.error("Error fetching tokens:", responseData);
  }
}

// Function to handle authentication
function authenticateUser() {
  // Build OAuth 2.0 URL
  const params = {
    client_id: CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: "code",
    scope: SCOPES,
    include_granted_scopes: "true",
    state: "drive-access",
    access_type: "offline",
    prompt: "consent",
  };

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(
    params
  ).toString()}`;

  // Open Google's authentication page in a new tab
  const popup = window.open(authUrl, "_blank", "width=500,height=600");

  // Poll for the access token
  const pollInterval = setInterval(() => {
    try {
      const popupUrl = popup.location.href;

      console.log(popupUrl);

      if (popupUrl && popupUrl.includes("code=")) {
        // Parse the authorization code from the redirect URI
        const urlParams = new URLSearchParams(popup.location.search);
        const code = urlParams.get("code");

        // Exchange the authorization code for tokens
        exchangeCodeForTokens(code);
        popup.close(); // Close the popup after successful authentication
        clearInterval(pollInterval);
      }
    } catch (error) {
      // Wait for the popup to complete authentication
    }

    // Handle user closing the popup
    if (popup.closed) {
      clearInterval(pollInterval);
      alert("Authentication popup closed.");
    }
  }, 500);
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem("refresh_token");

  if (!refreshToken) {
    alert("Refresh token not found. Please authenticate again.");
    return;
  }

  try {
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    if (!response.ok) throw new Error("Error refreshing access token.");

    const data = await response.json();
    const newAccessToken = data.access_token;

    // Save the new access token
    localStorage.setItem("access_token", newAccessToken);
    return newAccessToken;
  } catch (error) {
    console.error("Failed to refresh token:", error);
    alert("Failed to refresh token. Please authenticate again.");
  }
}

// Function to list files from Google Drive
async function listFiles() {
  const accessToken = localStorage.getItem("access_token");

  if (!accessToken) {
    console.log("Please authenticate first.");
    return;
  }

  try {
    const moreThan900Images = document.querySelectorAll("img") && Array.from(document.querySelectorAll("img"))?.length > 900;

    let fields = "";

    if (moreThan900Images) fields = "nextPageToken, files(id,name,thumbnailLink,createdTime)";
    else fields = "files(id,name,thumbnailLink,createdTime)";

    const params = new URLSearchParams({
      q: `'${FOLDER_ID}' in parents and mimeType contains 'image/'`,
      orderBy: "createdTime",
      fields: fields,
      pageSize: 1000,
    });

    if (moreThan900Images && nextPageToken) {
      params.append("pageToken", nextPageToken);
    }

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        mode: "cors", // Ensure CORS mode is enabled
      }
    );

    console.log("response.status: ", response.status);

    if (!response.ok && response.status === 401) {
      accessToken = await refreshAccessToken();

      if (!accessToken) return;

      return listFiles();
    }

    if (!response.ok && response.status !== 401)
      throw new Error("Error fetching files from Google Drive");

    const data = await response.json();

    if (nextPageToken == null && data?.nextPageToken) nextPageToken = data.nextPageToken;

    displayFiles(data.files);
  } catch (error) {
    console.error(error);
    alert("Failed to fetch files. Check the console for details.");
  }
}

async function loadImageWithRetry(file) {
  const delayBaseMs = 1000; // Base delay for exponential backoff

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure the image isn't already in the container
      if (document.querySelector(`img[data-id="${file.id}"]`)) {
        console.log(`Image ${file.name} already exists in the container.`);
        return;
      }

      // Attempt to load the image
      await preloadAndAttachImage(file);
      console.log(`Loaded image ${file.name} on attempt ${attempt}`);

      return; // Exit the function if successful
    } catch (error) {
      console.log(`Attempt ${attempt} failed for ${file.name}:`, error);

      if (attempt === maxRetries) {
        throw new Error(`Max retries reached for ${file.name}`);
      }

      // Exponential backoff with jitter
      const delayMs =
        Math.min(delayBaseMs * Math.pow(2, attempt - 1), 10000) +
        Math.random() * 1000;

      console.log(`Retrying ${file.name} after ${Math.round(delayMs)}ms...`);

      await delay(delayMs);
    }
  }
}

// Function to display files
async function displayFiles(files) {
  const newest = files.filter((file) => !imagesIdList.includes(file.id));
  console.log({ files });
  console.log({ newest });

  if (newest.length > 0) {
    for (const file of newest) {
      try {
        if (loadAll) {
          loadImageWithRetry(file); // Retry logic for loading thumbnails
        } else if (loadAll) {
          await loadImageWithRetry(file); // Retry logic for loading thumbnails
        }
      } catch (error) {
        console.error(`Failed to load image ${file.name}:`, error);
      }
    }
  }
}

function preloadAndAttachImage(file) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`img[data-id="${file.id}"]`)) {
      console.log(`Image ${file.name} already exists in the container.`);
      return resolve();
    }

    const alreadyHave = imagesIdList.includes(file.id);
    if (!alreadyHave) {
      const img = new Image();

      img.src = file.thumbnailLink.replace(/=s\d*$/, "=s4000");

      img.setAttribute("data-id", file.id); // Add a custom attribute to track the ID
      img.setAttribute("data-created-time", file.createdTime); // Add a custom attribute to track the ID

      img.onload = () => {
        // Create a new slide
        const slideIndex = container && container.childElementCount + 1;

        console.log({ slideIndex });

        const slide = document.createElement("li");
        slide.className = "carousel__slide";
        slide.id = `carousel__slide${slideIndex}`;
        slide.tabIndex = 0;

        // Create the snapper container
        const snapper = document.createElement("div");
        snapper.className = "carousel__snapper";

        // Previous button
        if (container && container.childElementCount > 0) {
          const prevSlideId = `carousel__slide${slideIndex - 1}`;

          const prevButton = document.createElement("a");
          prevButton.href = `#${prevSlideId}`;
          prevButton.className = "carousel__prev";
          prevButton.textContent = "";

          snapper.appendChild(prevButton);
        }

        // Next button
        const nextSlideId = `carousel__slide${slideIndex + 1}`; // Loop back to the first slide for the last one

        const nextButton = document.createElement("a");
        nextButton.href = `#${nextSlideId}`;
        nextButton.className = "carousel__next";
        nextButton.textContent = "";
        snapper.appendChild(nextButton);

        if (document.querySelector(`img[data-id="${file.id}"]`)) {
          console.log(`Image ${file.name} already exists in the container.`);
          return resolve();
        }

        // Append the image to the snapper
        snapper.appendChild(img);
        slide.appendChild(snapper);

        // Append the slide to the viewport
        container.appendChild(slide);

        // Create and add navigation buttons
        const navItem = document.createElement("li");
        navItem.className = "carousel__navigation-item";

        const navButton = document.createElement("a");
        navButton.href = `#carousel__slide${slideIndex}`;
        navButton.className = "carousel__navigation-button";
        navButton.textContent = `Go to slide ${slideIndex}`;

        navItem.appendChild(navButton);

        navigationList.appendChild(navItem);

        imagesIdList.push(file.id);

        goToSlide(slideIndex - 1);

        resolve();
      };

      img.onerror = (error) => {
        reject(`Error loading image ${file.name}: ${error}`);
      };
    } else {
      resolve();
    }
  });
}

// Function to go to a specific slide
const goToSlide = (index) => {
  const targetSlide = document.querySelector(`#carousel__slide${index + 1}`);

  if (targetSlide) targetSlide.scrollIntoView({ behavior: "smooth" });
};

const openMenu = () => {
  document.getElementById("header").style.maxHeight = "";
  document.getElementById("header").style.padding = "10px 8vw";
  
  document.querySelector("section.carousel").style.paddingTop = "85vh"
  
  document.querySelector("svg.svg-menu-opened").style.display = "none";
  document.querySelector("svg.svg-menu-closed").style.display = "block";
};

const closeMenu = () => {
  document.getElementById("header").style.maxHeight = "0px";
  document.getElementById("header").style.padding = "0px";

  document.querySelector("section.carousel").style.paddingTop = "98vh"

  document.querySelector("svg.svg-menu-opened").style.display = "block";
  document.querySelector("svg.svg-menu-closed").style.display = "none";
};

// Attach functions to buttons
document
  .getElementById("authorize-button")
  .addEventListener("click", authenticateUser);
document
  .getElementById("fetch-images-button")
  .addEventListener("click", listFiles);

document
  .querySelector("svg.svg-menu-opened")
  .addEventListener("click", openMenu);
document
  .querySelector("svg.svg-menu-closed")
  .addEventListener("click", closeMenu);

// Initialize the carousel
const startAutoPass = () => {
  let index = 0;

  setInterval(() => {
    if (index === imagesIdList.length) index = 0;

    if (index < imagesIdList.length && imagesIdList.length > 0) {
      //         addSlide(demoSlides[index]);
      goToSlide(index);
      index++;
    }
  }, secondsToPassImage * 1000); // Add a new slide every 3 seconds
};

// Check token validity and list files on page load
window.onload = () => {
  startAutoPass();

  setInterval(listFiles, secondsToReload * 1000); // 5000 milliseconds = 5 seconds
};
