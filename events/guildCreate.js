const mysql = require("mysql2/promise");
const config = require("../config.json");

module.exports = {
  name: "guildCreate",
  async execute(guild) {
    // Create a MySQL pool (you might want to refactor this so you share a single pool across files)
    const db = mysql.createPool({
      host: config.mysql.host,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    try {
      // Insert the guild with empty/default values for ticket_category and transcript_channel.
      await db.query(
        "INSERT INTO ticket_settings (guild_id, ticket_category, transcript_channel) VALUES (?, ?, ?)",
        [guild.id, "", ""]
      );
      console.log(`Guild ${guild.id} added to ticket_settings.`);
    } catch (error) {
      console.error(`Error inserting guild ${guild.id} into ticket_settings:`, error);
    }
  },
};
