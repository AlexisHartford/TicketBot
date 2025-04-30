const mysql = require("mysql2/promise");
const config = require("../config.json");

module.exports = {
  name: "guildDelete",
  async execute(guild) {
    // Create a MySQL pool
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
      // Remove the guild from the ticket_settings table.
      await db.query("DELETE FROM ticket_settings WHERE guild_id = ?", [guild.id]);
      console.log(`Guild ${guild.id} removed from ticket_settings.`);
    } catch (error) {
      console.error(`Error removing guild ${guild.id} from ticket_settings:`, error);
    }
  },
};
