const mysql = require("mysql2/promise");
const config = require("../config.json");

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

async function initializeDatabase() {
  try {
    // Existing table initializations...
    await db.query(`
      CREATE TABLE IF NOT EXISTS ticket_settings (
        guild_id VARCHAR(32) NOT NULL,
        ticket_category VARCHAR(32) DEFAULT NULL,
        transcript_channel VARCHAR(32) DEFAULT NULL,
        staff_role VARCHAR(32) DEFAULT NULL,
        ping_staff TINYINT(1) DEFAULT 0,
        PRIMARY KEY (guild_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS server_status (
        server_id VARCHAR(32) NOT NULL,
        last_heartbeat INT NOT NULL,
        PRIMARY KEY (server_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS invite_stats (
        guild_id VARCHAR(64) NOT NULL,
        inviter_id VARCHAR(64) NOT NULL,
        inviter_tag VARCHAR(100) NOT NULL,
        total_uses INT NOT NULL DEFAULT 0,
        PRIMARY KEY (guild_id, inviter_id)
      );
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS invite_logs (
        guild_id VARCHAR(64) NOT NULL,
        inviter_id VARCHAR(64) NOT NULL,
        inviter_tag VARCHAR(100) NOT NULL,
        user_id VARCHAR(64) NOT NULL,
        user_tag VARCHAR(100) NOT NULL,
        invite_code VARCHAR(32) NOT NULL,
        join_date DATETIME NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      );
    `);

    // Create the table for voice channels if it doesn't exist
    await db.query(`
      CREATE TABLE IF NOT EXISTS created_voice_channels (
        guild_id VARCHAR(255),
        channel_id VARCHAR(255) PRIMARY KEY,
        owner_id VARCHAR(255),
        name VARCHAR(255)
      )
    `);

    console.log("Database tables ensured.");
  } catch (error) {
    console.error("Error initializing database tables:", error);
  }
}

async function addExistingGuildsToDatabase(client) {
  // Iterate over every guild the bot is in
  client.guilds.cache.forEach(async (guild) => {
    try {
      // Check if the guild already has a record in ticket_settings
      const [rows] = await db.query(
        "SELECT guild_id FROM ticket_settings WHERE guild_id = ?",
        [guild.id]
      );
      if (rows.length === 0) {
        // Insert a new record with default values if none exists
        await db.query(
          "INSERT INTO ticket_settings (guild_id, ticket_category, transcript_channel) VALUES (?, ?, ?)",
          [guild.id, "", ""]
        );
        console.log(`Guild ${guild.id} added to ticket_settings.`);
      }
    } catch (error) {
      console.error(`Error processing guild ${guild.id}:`, error);
    }
  });
}

async function loadVoiceChannels(client) {
  try {
    // Initialize the in-memory map if it doesn't exist
    if (!client.voiceChannelOwners) {
      client.voiceChannelOwners = new Map();
    }

    // Query the created_voice_channels table
    const [rows] = await db.query(
      "SELECT guild_id, channel_id, owner_id, name FROM created_voice_channels"
    );
    rows.forEach((row) => {
      client.voiceChannelOwners.set(row.channel_id, {
        owner: row.owner_id,
        name: row.name,
      });
      console.log(`Loaded voice channel ${row.channel_id} for guild ${row.guild_id} from DB.`);
    });
  } catch (error) {
    console.error("Error loading voice channels:", error);
  }
}

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    console.log("Bot is ready!");

    // Initialize the database tables.
    await initializeDatabase();

    // Auto-add existing guilds to the ticket_settings table.
    await addExistingGuildsToDatabase(client);

    // Load existing voice channels into memory so they can be managed post-restart.
    await loadVoiceChannels(client);
  },
};
