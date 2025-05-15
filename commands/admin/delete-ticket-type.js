const { SlashCommandBuilder, PermissionFlagsBits, ButtonStyle, ActionRowBuilder, ButtonBuilder, ChannelType } = require("discord.js");
const mysql = require("mysql2/promise");
const config = require("../../config.json");

const db = mysql.createPool({
  host: config.mysql.host,
  user: config.mysql.user,
  password: config.mysql.password,
  database: config.mysql.database,
});

module.exports = {
  data: new SlashCommandBuilder()
    .setName("delete-ticket-type")
    .setDescription("Delete a ticket type button and remove it from the database.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("type_name")
        .setDescription("The ticket type name to delete")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const typeName = interaction.options.getString("type_name");
    const customIdToDelete = `create_ticket_${typeName}`;

    try {
      // Get the ticket type info (button message id and channel)
      const [rows] = await db.query(
        "SELECT button_channel, button_message_id FROM ticket_types WHERE guild_id = ? AND type_key = ?",
        [guildId, typeName]
      );

      if (rows.length === 0) {
        return interaction.reply({
          content: `⚠️ Ticket type "${typeName}" not found.`,
          ephemeral: true,
        });
      }

      const { button_channel, button_message_id } = rows[0];
      const channel = await interaction.guild.channels.fetch(button_channel).catch(() => null);

      if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({
          content: "❌ The button channel could not be found or is not a text channel.",
          ephemeral: true,
        });
      }

      const message = await channel.messages.fetch(button_message_id).catch(() => null);

      if (!message) {
        // Message doesn't exist or deleted
        // Just delete DB entry and reply
        await db.query("DELETE FROM ticket_types WHERE guild_id = ? AND type_key = ?", [guildId, typeName]);
        return interaction.reply({
          content: `⚠️ Button message not found. Ticket type "${typeName}" has been removed from the database.`,
          ephemeral: true,
        });
      }

      // Extract existing buttons from the message
      let buttons = [];
      for (const row of message.components) {
        buttons = buttons.concat(row.components);
      }

      // Filter out the button to delete
      const filteredButtons = buttons.filter((btn) => btn.customId !== customIdToDelete);

      if (filteredButtons.length === buttons.length) {
        // No button found to delete
        return interaction.reply({
          content: `⚠️ No button found for ticket type "${typeName}" on the message.`,
          ephemeral: true,
        });
      }

      if (filteredButtons.length === 0) {
        // No buttons left after deletion -> delete the whole message
        await message.delete().catch(() => {
          console.warn(`Could not delete button message ${button_message_id} from channel ${button_channel}`);
        });
      } else {
        // Rebuild action rows with remaining buttons (max 5 per row)
        const actionRows = [];
        for (let i = 0; i < filteredButtons.length; i += 5) {
          actionRows.push(new ActionRowBuilder().addComponents(filteredButtons.slice(i, i + 5)));
        }

        await message.edit({ components: actionRows });
      }

      // Finally delete the DB entry
      await db.query("DELETE FROM ticket_types WHERE guild_id = ? AND type_key = ?", [guildId, typeName]);

      await interaction.reply({
        content: `✅ Ticket type "${typeName}" button has been deleted successfully.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("Error deleting ticket type button:", err);
      await interaction.reply({
        content: "❌ Failed to delete the ticket type button.",
        ephemeral: true,
      });
    }
  },

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const guildId = interaction.guild.id;

    try {
      const [rows] = await db.query("SELECT type_key FROM ticket_types WHERE guild_id = ?", [guildId]);

      const choices = rows.map((row) => row.type_key);
      const filtered = choices.filter((choice) =>
        choice.toLowerCase().startsWith(focused.toLowerCase())
      );

      await interaction.respond(filtered.map((choice) => ({ name: choice, value: choice })));
    } catch (err) {
      console.error("Autocomplete error:", err);
      await interaction.respond([]);
    }
  },
};
