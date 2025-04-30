const { SlashCommandBuilder, PermissionsBitField, ChannelType } = require('discord.js');
const mysql = require('mysql2/promise');
const config = require('../../config.json');

// Create a new DB pool using the same credentials as your main app.
// (Alternatively, if you export your pool from the main file, require it instead.)
const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setconfig')
    .setDescription('Set the ticket category, transcript channel, and staff role in the database.')
    .addChannelOption(option =>
      option.setName('ticket_category')
        .setDescription('Select the ticket category (must be a category channel)')
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addChannelOption(option =>
      option.setName('transcript_channel')
        .setDescription('Select the transcript channel (must be a text channel)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addRoleOption(option =>
      option.setName('staff_role')
        .setDescription('Select the staff role for ticket support')
        .setRequired(true)
    ),
  async execute(interaction) {
    // Check if the user has Administrator permission.
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You don't have permission to use this command.", ephemeral: true });
    }

    const ticketCategoryChannel = interaction.options.getChannel('ticket_category');
    const transcriptChannel = interaction.options.getChannel('transcript_channel');
    const staffRole = interaction.options.getRole('staff_role');

    try {
      // Use the guild id from the interaction as the unique identifier.
      const guildId = interaction.guild.id;
      // Update or insert the configuration into the ticket_settings table.
      await db.query(
        "REPLACE INTO ticket_settings (guild_id, ticket_category, transcript_channel, staff_role) VALUES (?, ?, ?, ?)",
        [guildId, ticketCategoryChannel.id, transcriptChannel.id, staffRole.id]
      );
      return interaction.reply({ content: "Configuration updated successfully!", ephemeral: true });
    } catch (error) {
      console.error("Error updating configuration:", error);
      return interaction.reply({ content: "There was an error updating the configuration.", ephemeral: true });
    }
  },
};
