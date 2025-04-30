// Define Required Packages
const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mysql = require("mysql2/promise");
const { exec } = require("child_process");

const app = express();

// Load Configuration
const config = require("./config.json");

// MySQL Database Connection
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

let lastHeartbeatTimestamp = 0;

async function updateHeartbeat() {
  const timestamp = Math.floor(Date.now() / 1000);
  lastHeartbeatTimestamp = timestamp;
  try {
    await db.query(
      "REPLACE INTO server_status (server_id, last_heartbeat) VALUES (?, ?)",
      [config.server_id, timestamp]
    );
  } catch (error) {
    console.error("MySQL Heartbeat Error:", error);
  }
}

let discordClient = null;
let botActive = false;

function registerCommandsAndEvents(client) {
  client.commands = new Collection();
  const eventsPath = path.join(__dirname, "events");
  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));
  const foldersPath = path.join(__dirname, "commands");
  const commandFolders = fs.readdirSync(foldersPath);

  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`The command was added to Server! ${command.data.name}`);
      }
    }
  }

  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

async function activateBot() {
  if (botActive) return;
  console.log("Activating bot for server_id", config.server_id);
  discordClient = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  });

  registerCommandsAndEvents(discordClient);

  try {
    await discordClient.login(config.discord.token);
    botActive = true;
    console.log("Bot activated and logged in.");
  } catch (error) {
    console.error("Error activating bot:", error);
  }
}

async function deactivateBot() {
  if (!botActive || !discordClient) return;
  console.log("Deactivating bot for server_id", config.server_id);
  try {
    await discordClient.destroy();
    discordClient = null;
    botActive = false;
    console.log("Bot deactivated.");
  } catch (error) {
    console.error("Error deactivating bot:", error);
  }
}

async function checkFailoverStatus() {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    const threshold = 5;
    const [rows] = await db.query(
      "SELECT server_id, last_heartbeat FROM server_status WHERE server_id < ?",
      [config.server_id]
    );

    return rows.some(row => currentTime - row.last_heartbeat <= threshold);
  } catch (error) {
    console.error("Failover Check Error:", error);
    return false;
  }
}

async function checkAndToggleBot() {
  const higherPriorityActive = await checkFailoverStatus();
  if (higherPriorityActive) {
    if (botActive) {
      console.log("Higher priority server detected. Deactivating this bot instance.");
      await deactivateBot();
    }
  } else {
    if (!botActive) {
      console.log("No higher priority server detected. Activating this bot instance.");
      await activateBot();
    }
  }
}

// Auto-update checker
async function checkForUpdate() {
  try {
    const current = require("./version.json").commit;
    const { data } = await axios.get("https://api.github.com/repos/YOUR_USERNAME/YOUR_REPO/commits/main");
    const latest = data.sha;

    if (current !== latest) {
      console.log("New version detected. Updating...");
      exec("git pull && npm install", (err, stdout, stderr) => {
        if (err) return console.error("Update failed:", stderr);
        fs.writeFileSync("./version.json", JSON.stringify({ commit: latest }, null, 2));
        console.log("Update applied. Restarting...");
        exec("pm2 restart bot", (err) => {
          if (err) console.error("Restart failed:", err);
        });
      });
    }
  } catch (err) {
    console.error("Update check failed:", err);
  }
}

// Serve auth
app.get("/auth", (req, res) => {
  const discordAuthUrl = "https://discord.com/api/oauth2/authorize?client_id=1348418225880301622&redirect_uri=https://ticket.galaxyvr.net/dashboard.html&response_type=token&scope=identify%20guilds";
  res.redirect(discordAuthUrl);
});

// Bot invite
const BOT_CLIENT_ID = process.env.BOT_CLIENT_ID || config.discord.client.id; 
const BOT_PERMISSIONS = 1118839105616;

app.get("/api/invite-url", (req, res) => {
  const guildId = req.query.guild_id;
  if (!guildId) return res.status(400).json({ error: "guild_id query parameter is required" });
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${BOT_CLIENT_ID}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}&guild_id=${guildId}`;
  res.json({ inviteUrl });
});

// Guilds
app.get("/api/ticket_settings", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT guild_id FROM ticket_settings");
    const guildIds = rows.map(row => String(row.guild_id));
    res.json(guildIds);
  } catch (error) {
    console.error("Error fetching ticket settings:", error);
    res.status(500).json({ error: "Error fetching ticket settings" });
  }
});

// Serve public dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Error logging
let appStatus = 1;
const logErrorToFile = (error) => {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${error.stack}\n`;
  fs.appendFile("error.log", logMessage, (err) => {
    if (err) console.error("Error writing to error.log:", err);
  });
};

app.use((req, res, next) => {
  if (appStatus) return next();
  throw new Error("App is closing");
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  logErrorToFile(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Tasks
const heartbeatInterval = setInterval(updateHeartbeat, 1000);
const failoverInterval = setInterval(checkAndToggleBot, 5000);
const updateCheckInterval = setInterval(checkForUpdate, 60000); // every 60s

(async () => {
  await updateHeartbeat();
  const higherPriorityActive = await checkFailoverStatus();
  if (!higherPriorityActive) {
    await activateBot();
  } else {
    console.log("Higher priority server active on initial check. Bot remains inactive.");
  }
})();

// Express
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Dashboard available at http://localhost:${PORT}/`);
});

process.on("SIGINT", () => {
  console.log("*** SIGINT received. Shutting down gracefully. ***");
  appStatus = 0;
  clearInterval(heartbeatInterval);
  clearInterval(failoverInterval);
  clearInterval(updateCheckInterval);
  if (discordClient) {
    discordClient.destroy().then(() => {
      console.log("Discord client destroyed.");
      process.exit(0);
    }).catch((error) => {
      console.error("Error destroying Discord client:", error);
      process.exit(1);
    });
  } else {
    process.exit(0);
  }
});
