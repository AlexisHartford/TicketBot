const fs = require('fs');
const path = require('path');
const threadsFilePath = path.join(__dirname, 'threads.json');

function loadThreads() {
  try {
    if (!fs.existsSync(threadsFilePath)) {
      // File does not exist, so return an empty array
      return [];
    }
    // Read the file and parse its content as JSON
    const data = fs.readFileSync(threadsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading threads:', error);
    return [];
  }
}

function saveThreads(threads) {
  try {
    // Write the JSON stringified data back to the file
    fs.writeFileSync(threadsFilePath, JSON.stringify(threads, null, 2), 'utf8');
  } catch (error) {
    console.error('Error saving threads:', error);
  }
}
