const { Client, Collection, GatewayIntentBits, Partials } = require("discord.js");
const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const mysql = require("mysql2/promise");
const { exec } = require("child_process");

const app = express();
const config = require("./config.json");

// GitHub settings (for public repo)
const REPO_OWNER = "AlexisHartford";
const REPO_NAME = "TicketBot";

// Database pool
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

let discordClient = null;
let botActive = false;
let lastHeartbeatTimestamp = 0;

// Heartbeat
async function updateHeartbeat() {
  const timestamp = Math.floor(Date.now() / 1000);
  lastHeartbeatTimestamp = timestamp;
  try {
    await db.query(
      "REPLACE INTO server_status (server_id, last_heartbeat) VALUES (?, ?)",
      [config.server_id, timestamp]
    );
  } catch (error) {
    console.error("Heartbeat error:", error);
  }
}

// Require cache clearing
function clearRequireCache(filePath) {
  delete require.cache[require.resolve(filePath)];
}

// Command and event loader
function registerCommandsAndEvents(client) {
  client.commands = new Collection();

  const foldersPath = path.join(__dirname, "commands");
  const commandFolders = fs.readdirSync(foldersPath);
  for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder);
    const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));
    for (const file of commandFiles) {
      const filePath = path.join(commandsPath, file);
      clearRequireCache(filePath);
      const command = require(filePath);
      if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
        console.log(`Loaded command: ${command.data.name}`);
      }
    }
  }

  const eventsPath = path.join(__dirname, "events");
  const eventFiles = fs.readdirSync(eventsPath).filter((file) => file.endsWith(".js"));
  for (const file of eventFiles) {
    const filePath = path.join(eventsPath, file);
    clearRequireCache(filePath);
    const event = require(filePath);
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }
  }
}

// Bot start/stop
async function activateBot() {
  if (botActive) return;
  console.log("Activating bot...");
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
    console.log("Bot logged in.");
  } catch (error) {
    console.error("Login error:", error);
  }
}

async function deactivateBot() {
  if (!botActive || !discordClient) return;
  console.log("Deactivating bot...");
  try {
    await discordClient.destroy();
    botActive = false;
    discordClient = null;
    console.log("Bot deactivated.");
  } catch (error) {
    console.error("Deactivation error:", error);
  }
}

// Failover logic
async function checkFailoverStatus() {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    const [rows] = await db.query(
      "SELECT server_id, last_heartbeat FROM server_status WHERE server_id < ?",
      [config.server_id]
    );
    return rows.some((row) => currentTime - row.last_heartbeat <= 5);
  } catch (error) {
    console.error("Failover check failed:", error);
    return false;
  }
}

async function checkAndToggleBot() {
  const otherActive = await checkFailoverStatus();
  if (otherActive && botActive) {
    await deactivateBot();
  } else if (!otherActive && !botActive) {
    await activateBot();
  }
}

// Auto-updater (for public repo)
async function checkForUpdate() {
  try {
    const current = require("./version.json").commit;
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/main`;

    const { data } = await axios.get(url, {
      headers: { "User-Agent": "GalaxyBot-Updater" }
    });

    const latest = data.sha;

    if (current === latest) {
      console.log("✅ Bot is already up-to-date.");
      return;  // Early exit if the bot is already up-to-date.
    }

    console.log("New update detected. Pulling...");

    exec("git pull && npm install", (err, stdout, stderr) => {
      if (err) {
        // Check for tracking error
        if (stderr.includes("no tracking information")) {
          console.error("❌ Git pull failed: No upstream tracking branch is set.");
          console.error("👉 Fix it by running this command in your repo:");
          console.error("   git branch --set-upstream-to=origin/main main");
        } else {
          console.error("Update failed:", stderr || err.message);
        }
        return;
      }

      // Write new commit hash to version.json
      fs.writeFileSync("./version.json", JSON.stringify({ commit: latest }, null, 2));
      console.log("✅ Update successful. Restarting bot...");

      // Restart the bot by exiting the process
      process.exit(0);  // This will exit the process, causing the environment to restart the bot.
    });
  } catch (err) {
    console.error("Update check failed:", err.message || err);
  }
}



// Express routes
app.get("/auth", (req, res) => {
  res.redirect("https://discord.com/api/oauth2/authorize?client_id=1348418225880301622&redirect_uri=https://ticket.galaxyvr.net/dashboard.html&response_type=token&scope=identify%20guilds");
});

app.get("/api/invite-url", (req, res) => {
  const guildId = req.query.guild_id;
  const BOT_CLIENT_ID = config.discord.client.id;
  const BOT_PERMISSIONS = 1118839105616;
  if (!guildId) return res.status(400).json({ error: "guild_id is required" });
  const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${BOT_CLIENT_ID}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}&guild_id=${guildId}`;
  res.json({ inviteUrl });
});

app.get("/api/ticket_settings", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT guild_id FROM ticket_settings");
    res.json(rows.map(r => String(r.guild_id)));
  } catch (err) {
    console.error("Ticket settings error:", err);
    res.status(500).json({ error: "DB error" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

// Graceful shutdown
let appStatus = 1;
const heartbeatInterval = setInterval(updateHeartbeat, 1000);
const failoverInterval = setInterval(checkAndToggleBot, 5000);
const updateCheckInterval = setInterval(checkForUpdate, 60000); // 1 min

app.use((req, res, next) => {
  if (appStatus) return next();
  throw new Error("App closing");
});

process.on("SIGINT", () => {
  console.log("SIGINT received. Shutting down.");
  appStatus = 0;
  clearInterval(heartbeatInterval);
  clearInterval(failoverInterval);
  clearInterval(updateCheckInterval);
  if (discordClient) {
    discordClient.destroy().then(() => process.exit(0));
  } else {
    process.exit(0);
  }
});

process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

// Initial start
(async () => {
  await updateHeartbeat();
  const active = await checkFailoverStatus();
  if (!active) {
    await activateBot();
  } else {
    console.log("Higher priority bot active. Staying idle.");
  }
})();
