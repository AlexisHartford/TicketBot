const { 
    SlashCommandBuilder, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionsBitField 
  } = require('discord.js');
  
  module.exports = {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Creates a ticket channel for support. (Admin only)')
      // Restrict usage to administrators via default member permissions.
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
    async execute(interaction) {
      // Create an embed to explain the ticket process.
      const embed = new EmbedBuilder()
        .setTitle("Support Ticket")
        .setDescription("Press the button below to create a ticket channel. Only you and our staff will be able to see this channel.")
        .setColor(0x00AE86);
  
      // Create a button with a custom ID that we'll listen for.
      // NOTE: The customId is set to "createTicket" – this must match in your interaction handler.
      const button = new ButtonBuilder()
        .setCustomId('createTicket')
        .setLabel('Create Ticket')
        .setStyle(ButtonStyle.Primary);
  
      const row = new ActionRowBuilder().addComponents(button);
  
      // Send the embed with the button.
      await interaction.reply({ embeds: [embed], components: [row] });
    },
  };
  