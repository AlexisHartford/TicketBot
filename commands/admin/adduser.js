const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Adds a user to this channel and pings them. (Admin only)')
    // Restrict usage to administrators.
    .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
    .addUserOption(option =>
      option.setName('target')
        .setDescription('The user to add to this channel')
        .setRequired(true)
    ),
  async execute(interaction) {
    // Ensure the command is executed within a guild channel.
    if (!interaction.guild || !interaction.channel) {
      return interaction.reply({ content: 'This command can only be used in a guild channel.', ephemeral: true });
    }

    // Check if the bot has the ManageChannels permission.
    if (!interaction.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ content: "I don't have permission to modify channel permissions.", ephemeral: true });
    }

    // Get the target user.
    const targetUser = interaction.options.getUser('target');

    try {
      // Update the current channel's permission overwrites to allow the target user.
      await interaction.channel.permissionOverwrites.edit(targetUser.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });

      // Reply to the command and ping the target user.
      await interaction.reply({ content: `Added <@${targetUser.id}> to this channel. Welcome!` });
    } catch (error) {
      console.error('Error adding user to channel:', error);
      await interaction.reply({ content: 'There was an error adding the user to this channel.', ephemeral: true });
    }
  },
};
