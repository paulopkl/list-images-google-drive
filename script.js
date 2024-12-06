// TODO(developer): Set to client ID and API key from the Developer Console
const CLIENT_ID =
  "....apps.googleusercontent.com";
const CLIENT_SECRET = "...";

const API_KEY = "...";

const FOLDER_ID = "...-...";

// Discovery doc URL for APIs used by the quickstart
const DISCOVERY_DOC = "https://docs.googleapis.com/$discovery/rest?version=v1";
const DISCOVERY_DOC_2 =
  "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";

// Authorization scopes required by the API; multiple scopes can be
// included, separated by spaces.
const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive",
  // 'https://www.googleapis.com/auth/drive.metadata.readonly'
].join(" ");

const REDIRECT_URI = "http://localhost:5500";

const secondsToReload = 10;

let tokenClient;
let gapiInited = false;
let gisInited = false;

let accessToken = null;

// References to DOM elements
const loginButton = document.getElementById("login-button");
const imageContainer = document.getElementById("image-container");

const imagesIdList = [];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const tokenUrl = 'https://oauth2.googleapis.com/token';
  
  const data = new URLSearchParams();
  data.append('code', code);
  data.append('client_id', CLIENT_ID);
  data.append('client_secret', CLIENT_SECRET);
  data.append('redirect_uri', REDIRECT_URI);
  data.append('grant_type', 'authorization_code');  // This is for the exchange

  const response = await fetch(tokenUrl, {
    method: 'POST',
    body: data,
  });

  const responseData = await response.json();
  
  if (response.ok) {
    const { access_token, refresh_token, expires_in } = responseData;
    console.log('Access Token:', access_token);
    console.log('Refresh Token:', refresh_token);
    console.log('Expires in:', expires_in);

    // Save tokens to localStorage or sessionStorage
    localStorage.setItem('access_token', access_token);
    localStorage.setItem('refresh_token', refresh_token);
  } else {
    console.error('Error fetching tokens:', responseData);
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

      if (popupUrl && popupUrl.includes('code=')) {
        // Parse the authorization code from the redirect URI
        const urlParams = new URLSearchParams(popup.location.search);
        const code = urlParams.get('code');
        
        // Exchange the authorization code for tokens
        exchangeCodeForTokens(code);
        popup.close();  // Close the popup after successful authentication
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
    alert("Please authenticate first.");
    return;
  }

  try {
    const params = new URLSearchParams({
      q: `'${FOLDER_ID}' in parents and mimeType contains 'image/'`,
      orderBy: "createdTime",
      fields: "files(id,name,mimeType,thumbnailLink,createdTime)",
    });

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

    await delay(3000);

    if (!response.ok && response.status === 401) {
      accessToken = await refreshAccessToken();

      if (!accessToken) return;

      return listFiles();
    }

    if (!response.ok && response.status !== 401) throw new Error('Error fetching files from Google Drive');

    const data = await response.json();

    displayFiles(data.files);
  } catch (error) {
    console.error(error);
    alert("Failed to fetch files. Check the console for details.");
  }
}

async function loadImageWithRetry(file, container, maxRetries = 50) {
  const delayBaseMs = 1000; // Base delay for exponential backoff

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure the image isn't already in the container
      if (document.querySelector(`img[data-id="${file.id}"]`)) {
        console.log(`Image ${file.name} already exists in the container.`);
        return;
      }

      // Attempt to load the image
      await preloadAndAttachImage(file, container);
      console.log(`Loaded image ${file.name} on attempt ${attempt}`);

      return; // Exit the function if successful
    } catch (error) {
      console.warn(`Attempt ${attempt} failed for ${file.name}:`, error);

      if (attempt === maxRetries) {
        throw new Error(`Max retries reached for ${file.name}`);
      }

      // Exponential backoff with jitter
      const delayMs = Math.min(delayBaseMs * Math.pow(2, attempt - 1), 10000) + Math.random() * 1000;
      console.log(`Retrying ${file.name} after ${Math.round(delayMs)}ms...`);
      await delay(delayMs);
    }
  }
}

// Function to preload and attach an image to the container
function preloadAndAttachImage(file, container) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.src = file.thumbnailLink;
    img.setAttribute("data-id", file.id); // Add a custom attribute to track the ID

    img.onload = () => {
      // Attach the image after successful preload
      const link = document.createElement("a");
      link.href = `https://drive.google.com/uc?export=view&id=${file.id}`;
      link.target = "_blank";
      link.appendChild(img);

      container.prepend(link);
      resolve();
    };

    img.onerror = (error) => {
      reject(`Error loading image ${file.name}: ${error}`);
    };
  });
}

// Function to display files
async function displayFiles(files) {
  const container = document.getElementById("file-container");

  if (!files || files.length === 0) {
    container.innerHTML = "<p>No images found.</p>";
    return;
  }

  const newest = files.filter((file) => !imagesIdList.includes(file.id));

  for (const file of newest) {
    try {
      // Retry logic for loading thumbnails
      await loadImageWithRetry(file, container);

      imagesIdList.push(file.id);
    } catch (error) {
      console.error(`Failed to load image ${file.name}:`, error);
    }
  }
}

// Attach functions to buttons
document
  .getElementById("authorize-button")
  .addEventListener("click", authenticateUser);
document
  .getElementById("fetch-images-button")
  .addEventListener("click", listFiles);

// Check token validity
async function isTokenValid(token) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${token}`
    );
    console.log({ response });
    return response.ok;
  } catch {
    return false;
  }
}

// Initialize the app on page load
async function initialize() {
  const token = localStorage.getItem("access_token");

  if (token) {
    const valid = await isTokenValid(token);

    if (valid) {
      // Token is valid, list files
      listFiles();
    } else {
      // Token expired, clear it and ask for re-authentication
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) listFiles();

      initialize();
    }
  } else {
    alert("No token found. Please authenticate.");
  }
}

// Check token validity and list files on page load
window.onload = () => {
  initialize;

  setInterval(initialize, secondsToReload * 1000); // 5000 milliseconds = 5 seconds
}
