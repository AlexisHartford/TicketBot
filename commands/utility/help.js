const {
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  SlashCommandBuilder,
  ActionRowBuilder,
  ComponentType,
  EmbedBuilder,
} = require("discord.js");
const fs = require("fs");
const path = require("path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("gives you all commands"),
  async execute(interaction) {
    const foldersPath = path.join(__dirname, "../");
    const commandFolders = fs.readdirSync(foldersPath);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("starter")
      .setPlaceholder("Make a selection!");

    for (const folder of commandFolders) {
      const commandsPath = path.join(foldersPath, folder);
      const commandFiles = fs
        .readdirSync(commandsPath)
        .filter((file) => !file.includes("/owner/") && file.endsWith(".js"));

      // Add an option only if there are valid command files in the folder
      let folderd = "No Description";
      if (folder === "admin") {
        folderd = "Commands For Admins";
      } else if (folder === "fun") {
        folderd = "Commands For To Have Fun";
      } else if (folder === "utility") {
        folderd = "Elite Commands";
      }

      if (commandFiles.length > 0) {
        selectMenu.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(
              `${folder[0].toUpperCase()}${folder.slice(1).toLowerCase()}`
            )
            .setDescription(folderd)
            .setValue(folder)
        );
      }
    }

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const response = await interaction.reply({
      content: "Select an option:",
      components: [row],
      ephemeral: true,
    });

    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 3_600_000,
    });

    collector.on("collect", async (i) => {
      try {
        const selection = i.values[0];

        fs.readdir(`./commands/${selection}`, async (err, files) => {
          if (err) return console.error(err);

          const fields = files
            .filter((file) => !file.includes("/owner/") && file.endsWith(".js"))
            .map((file) => {
              const foldersPath = path.join(__dirname, "../");
              const commandFolders = fs.readdirSync(foldersPath);
              const commandsPath = path.join(foldersPath, selection);
              const filePath = path.join(commandsPath, `${file}`);
              const fileContent = fs.readFileSync(filePath, "utf-8");

              const setNameMatch = fileContent.match(/\.setName\(\s*["']([^"']+)["']\s*\)/);
              const setDescriptionMatch = fileContent.match(/\.setDescription\(\s*["']([^"']+)["']\s*\)/);

              const setName = setNameMatch ? setNameMatch[1] : "Unknown";
              const setDescription = setDescriptionMatch
                ? setDescriptionMatch[1]
                : "No description";

              return {
                name: setName,
                value: `${setDescription}`,
              };
            });

          const newembed = new EmbedBuilder()
            .setTitle(`Help - ${selection} `)
            .setDescription("Available commands are listed here")
            .addFields(fields);

          await interaction.editReply({
            embeds: [newembed],
            components: [row],
            ephemeral: true,
          });
          //await i.reply(`${i.user} has selected ${selection}!`);
          console.log(`Collected data for ${selection}`);
          await i.deferUpdate(); // or await i.reply({ content: "Interaction collected!", ephemeral: true });
  
        });
      } catch (error) {
        console.error("Error during collection:", error);
        // Handle the error or send an error message to the user
        await i.reply(
          "An error occurred during data collection. Please try again."
        );
      }
    });
  },
};
