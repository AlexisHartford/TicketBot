const { SlashCommandBuilder, PermissionsBitField, AttachmentBuilder } = require('discord.js');
const mysql = require("mysql2/promise");
const config = require("../../config.json");

module.exports = {
  data: new SlashCommandBuilder()
    .setName('listinvitedmembers')
    .setDescription('List all members invited by a specified user. (Admin only)')
    .addUserOption(option =>
      option.setName('inviter')
        .setDescription('The inviter whose invited members to list. Defaults to you.')
        .setRequired(false)
    ),
  async execute(interaction) {
    // Ensure only administrators can use this command
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return interaction.reply({ content: "You do not have permission to use this command.", ephemeral: true });
    }
    
    const inviterUser = interaction.options.getUser('inviter') || interaction.user;
    
    // Create a MySQL pool (consider sharing a pool across your project)
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
      // Query the invite_logs table for entries where this user is the inviter
      const [rows] = await db.query(
        `SELECT user_tag, user_id, join_date, invite_code 
         FROM invite_logs 
         WHERE guild_id = ? AND inviter_id = ? 
         ORDER BY join_date ASC`,
         [interaction.guild.id, inviterUser.id]
      );
      
      if (rows.length === 0) {
        return interaction.reply({ content: `${inviterUser.tag} has not invited any members (or no records were found).`, ephemeral: true });
      }
      
      // Build the output string with each invited member's info
      let output = `**Invited members by ${inviterUser.tag}:**\n`;
      rows.forEach((row, index) => {
        // Convert join_date to a Date, then to Unix timestamp (in seconds)
        const joinDate = new Date(row.join_date);
        const unixTimestamp = Math.floor(joinDate.getTime() / 1000);
        // Using Discord's timestamp markdown (<t:TIMESTAMP:F>) for a full timestamp display
        output += `${index + 1}. ${row.user_tag} (ID: ${row.user_id}) - Joined: <t:${unixTimestamp}:F> - Invite Code: ${row.invite_code}\n`;
      });
      
      // Discord messages have a character limit. If exceeded, send the output as a text file.
      if (output.length > 1900) {
        const attachment = new AttachmentBuilder(Buffer.from(output, 'utf-8'), { name: 'invited_members.txt' });
        return interaction.reply({ content: `Invited members by ${inviterUser.tag}:`, files: [attachment], ephemeral: true });
      } else {
        return interaction.reply({ content: output, ephemeral: true });
      }
    } catch (error) {
      console.error("Error fetching invited members:", error);
      return interaction.reply({ content: "There was an error fetching the invited members. Please try again later.", ephemeral: true });
    }
  }
};
