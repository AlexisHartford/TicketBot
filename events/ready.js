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
    // Ensure ticket_types table
    await db.query(`
    CREATE TABLE IF NOT EXISTS ticket_types (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guild_id VARCHAR(32) NOT NULL,
      type_key VARCHAR(100) NOT NULL,
      label VARCHAR(100) NOT NULL,
      button_message TEXT NOT NULL,
      ticket_category VARCHAR(32) NOT NULL,
      transcript_channel VARCHAR(30) DEFAULT NULL,
      button_channel VARCHAR(32) NOT NULL,
      button_message_id VARCHAR(32),
      staff_role VARCHAR(32),
      ping_staff BOOLEAN DEFAULT FALSE,
      UNIQUE KEY unique_ticket_type (guild_id, type_key)
    )
  `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        guild_id varchar(32) NOT NULL,
        user_id varchar(32) NOT NULL,
        referral_count int(11) DEFAULT 0,
        PRIMARY KEY (guild_id, user_id)
      )
    `);

    // Ensure server_status table
    await db.query(`
      CREATE TABLE IF NOT EXISTS referral_uses (
        guild_id varchar(32) NOT NULL,
        referrer_id varchar(32) NOT NULL,
        PRIMARY KEY (guild_id,referrer_id)
      ) 
  `);

    // Ensure invite_stats table
    await db.query(`
    CREATE TABLE IF NOT EXISTS invite_stats (
      guild_id VARCHAR(64) NOT NULL,
      inviter_id VARCHAR(64) NOT NULL,
      inviter_tag VARCHAR(100) NOT NULL,
      total_uses INT NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, inviter_id)
    )
  `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS main_voice_channels (
        guild_id varchar(50) NOT NULL,
        channel_id varchar(50) NOT NULL,
        PRIMARY KEY (guild_id,channel_id)
      )
  `);

    // Ensure invite_logs table
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
    )
  `);

    // Ensure created_voice_channels table
    await db.query(`
    CREATE TABLE IF NOT EXISTS created_voice_channels (
      guild_id VARCHAR(255),
      channel_id VARCHAR(255) PRIMARY KEY,
      owner_id VARCHAR(255),
      name VARCHAR(255)
    )
  `);

    console.log("✅ Database tables ensured.");
  } catch (error) {
    console.error("❌ Error initializing database tables:", error);
  }
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
      console.log(
        `Loaded voice channel ${row.channel_id} for guild ${row.guild_id} from DB.`
      );
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

    // Load existing voice channels into memory so they can be managed post-restart.
    await loadVoiceChannels(client);
  },
};
