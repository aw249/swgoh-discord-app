/**
 * /archetype command - Admin commands for managing squad archetypes
 * 
 * Subcommands:
 * - /archetype list - List all archetypes with optional search
 * - /archetype info <id> - Show details of a specific archetype
 * - /archetype generate <unit_id> - Generate archetype template from Comlink data
 * - /archetype missing - Show leaders without archetypes
 * - /archetype stats - Show archetype coverage statistics
 */

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { archetypeManager } from '../services/archetypeValidation/archetypeManager';

export const data = new SlashCommandBuilder()
  .setName('archetype')
  .setDescription('Manage squad archetype configurations')
  .addSubcommand(subcommand =>
    subcommand
      .setName('list')
      .setDescription('List all archetypes')
      .addStringOption(option =>
        option
          .setName('search')
          .setDescription('Search by name or tag')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('info')
      .setDescription('Show details of a specific archetype')
      .addStringOption(option =>
        option
          .setName('id')
          .setDescription('Archetype ID')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('generate')
      .setDescription('Generate archetype template for a unit')
      .addStringOption(option =>
        option
          .setName('unit_id')
          .setDescription('Unit base ID (e.g. DARTHVADER)')
          .setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('missing')
      .setDescription('Show leaders without archetypes')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('stats')
      .setDescription('Show archetype coverage statistics')
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'list':
      await handleList(interaction);
      break;
    case 'info':
      await handleInfo(interaction);
      break;
    case 'generate':
      await handleGenerate(interaction);
      break;
    case 'missing':
      await handleMissing(interaction);
      break;
    case 'stats':
      await handleStats(interaction);
      break;
    default:
      await interaction.reply({ content: 'Unknown subcommand', ephemeral: true });
  }
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const search = interaction.options.getString('search');
  
  let archetypes = search 
    ? archetypeManager.search(search)
    : archetypeManager.getAll();

  // Sort alphabetically
  archetypes = archetypes.sort((a, b) => a.displayName.localeCompare(b.displayName));

  if (archetypes.length === 0) {
    await interaction.reply({
      content: search 
        ? `No archetypes found matching "${search}"`
        : 'No archetypes configured',
      ephemeral: true,
    });
    return;
  }

  // Paginate results (25 per page)
  const pageSize = 25;
  const totalPages = Math.ceil(archetypes.length / pageSize);
  let currentPage = 0;

  const generateEmbed = (page: number): EmbedBuilder => {
    const start = page * pageSize;
    const end = Math.min(start + pageSize, archetypes.length);
    const pageArchetypes = archetypes.slice(start, end);

    const embed = new EmbedBuilder()
      .setTitle('🔧 Squad Archetypes')
      .setColor(0x5865F2)
      .setDescription(
        search 
          ? `Found ${archetypes.length} archetype(s) matching "${search}"`
          : `Total: ${archetypes.length} archetypes`
      )
      .setFooter({ text: `Page ${page + 1}/${totalPages}` });

    const lines = pageArchetypes.map(arch => {
      const reqCount = arch.requiredAbilities?.length || 0;
      const optCount = arch.optionalAbilities?.length || 0;
      const modes = arch.modes.map(m => m.replace('GAC_', '')).join('/');
      return `• **${arch.displayName}** \`${arch.id}\`\n  └ ${reqCount} req, ${optCount} opt | ${modes}`;
    });

    embed.addFields({ name: 'Archetypes', value: lines.join('\n') || 'None' });
    return embed;
  };

  if (totalPages === 1) {
    await interaction.reply({ embeds: [generateEmbed(0)] });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('prev')
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('next')
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(totalPages <= 1)
  );

  const response = await interaction.reply({
    embeds: [generateEmbed(0)],
    components: [row],
    fetchReply: true,
  });

  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 120000,
  });

  collector.on('collect', async (i) => {
    if (i.user.id !== interaction.user.id) {
      await i.reply({ content: 'This is not your command', ephemeral: true });
      return;
    }

    if (i.customId === 'prev') currentPage--;
    if (i.customId === 'next') currentPage++;

    const newRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1)
    );

    await i.update({ embeds: [generateEmbed(currentPage)], components: [newRow] });
  });

  collector.on('end', async () => {
    const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('prev')
        .setLabel('◀ Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId('next')
        .setLabel('Next ▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );
    await response.edit({ components: [disabledRow] }).catch(() => {});
  });
}

async function handleInfo(interaction: ChatInputCommandInteraction): Promise<void> {
  const archetypeId = interaction.options.getString('id', true);
  const archetype = archetypeManager.get(archetypeId);

  if (!archetype) {
    await interaction.reply({
      content: `Archetype \`${archetypeId}\` not found`,
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${archetype.displayName}`)
    .setColor(0x57F287)
    .setDescription(archetype.description || 'No description')
    .addFields(
      { name: 'ID', value: `\`${archetype.id}\``, inline: true },
      { name: 'Modes', value: archetype.modes.join(', '), inline: true },
      { 
        name: 'Extends', 
        value: archetype.extends ? `\`${archetype.extends}\`` : 'None', 
        inline: true 
      }
    );

  // Required units
  const reqUnits = archetype.composition?.requiredUnits || [];
  if (reqUnits.length > 0) {
    embed.addFields({
      name: '👥 Required Units',
      value: reqUnits.map(u => `\`${u}\``).join(', '),
    });
  }

  // Required abilities
  if (archetype.requiredAbilities && archetype.requiredAbilities.length > 0) {
    const abilityLines = archetype.requiredAbilities.map(a => {
      const type = a.abilityType === 'omicron' ? '🔵' : '⚡';
      const modes = a.modeGates ? ` (${a.modeGates.join('/')})` : '';
      return `${type} \`${a.abilityId}\`${modes}\n   └ ${a.reason}`;
    });
    embed.addFields({
      name: '✅ Required Abilities',
      value: abilityLines.join('\n').slice(0, 1024),
    });
  }

  // Optional abilities
  if (archetype.optionalAbilities && archetype.optionalAbilities.length > 0) {
    const optLines = archetype.optionalAbilities.map(a => {
      const type = a.abilityType === 'omicron' ? '🔵' : '⚡';
      const weight = Math.round((a.confidenceWeight || 0) * 100);
      return `${type} \`${a.abilityId}\` (+${weight}%)\n   └ ${a.reason}`;
    });
    embed.addFields({
      name: '➕ Optional Abilities',
      value: optLines.join('\n').slice(0, 1024),
    });
  }

  // Warnings
  if (archetype.warnings && archetype.warnings.length > 0) {
    embed.addFields({
      name: '⚠️ Warnings',
      value: archetype.warnings.map(w => `• ${w}`).join('\n'),
    });
  }

  // Tags
  if (archetype.tags && archetype.tags.length > 0) {
    embed.addFields({
      name: '🏷️ Tags',
      value: archetype.tags.map(t => `\`${t}\``).join(' '),
    });
  }

  await interaction.reply({ embeds: [embed] });
}

async function handleGenerate(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  const unitId = interaction.options.getString('unit_id', true).toUpperCase();

  try {
    const template = await archetypeManager.generateArchetypeTemplate(unitId);

    if (!template) {
      await interaction.editReply({
        content: `❌ Could not generate template for \`${unitId}\`. Unit may not exist or may not have a leadership ability.`,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`🔨 Generated Template: ${template.displayName}`)
      .setColor(0xFEE75C)
      .setDescription('This is an auto-generated template. Review and customise before using.')
      .addFields(
        { name: 'ID', value: `\`${template.id}\``, inline: true },
        { name: 'Modes', value: template.modes.join(', '), inline: true }
      );

    if (template.requiredAbilities && template.requiredAbilities.length > 0) {
      const lines = template.requiredAbilities.map(a => {
        const type = a.abilityType === 'omicron' ? '🔵 Omi' : '⚡ Zeta';
        return `• ${type}: \`${a.abilityId}\``;
      });
      embed.addFields({ name: 'Required Abilities', value: lines.join('\n') });
    }

    if (template.optionalAbilities && template.optionalAbilities.length > 0) {
      const lines = template.optionalAbilities.map(a => {
        const type = a.abilityType === 'omicron' ? '🔵 Omi' : '⚡ Zeta';
        const modes = a.modeGates ? ` (${a.modeGates.join('/')})` : '';
        return `• ${type}: \`${a.abilityId}\`${modes}`;
      });
      embed.addFields({ name: 'Optional Abilities', value: lines.join('\n') });
    }

    // Add JSON for easy copy
    const jsonSnippet = JSON.stringify(template, null, 2);
    if (jsonSnippet.length <= 1900) {
      embed.addFields({
        name: '📄 JSON Template',
        value: `\`\`\`json\n${jsonSnippet.slice(0, 1000)}${jsonSnippet.length > 1000 ? '\n...' : ''}\n\`\`\``,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({
      content: `❌ Error generating template: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleMissing(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply();

  try {
    const missingLeaders = await archetypeManager.getMissingLeaders();

    if (missingLeaders.length === 0) {
      await interaction.editReply({
        content: '✅ All leaders have archetypes configured!',
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Leaders Without Archetypes')
      .setColor(0xED4245)
      .setDescription(`Found ${missingLeaders.length} leader(s) without archetypes`);

    // Split into chunks for display
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const leader of missingLeaders.sort()) {
      const line = `\`${leader}\`\n`;
      if (currentChunk.length + line.length > 1000) {
        chunks.push(currentChunk);
        currentChunk = line;
      } else {
        currentChunk += line;
      }
    }
    if (currentChunk) chunks.push(currentChunk);

    for (let i = 0; i < Math.min(chunks.length, 3); i++) {
      embed.addFields({
        name: i === 0 ? 'Missing Leaders' : '\u200b',
        value: chunks[i],
        inline: true,
      });
    }

    if (chunks.length > 3) {
      embed.setFooter({ text: `... and ${missingLeaders.length - 30} more` });
    }

    embed.addFields({
      name: '💡 Tip',
      value: 'Use `/archetype generate <unit_id>` to create a template for any of these leaders',
    });

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply({
      content: `❌ Error fetching missing leaders: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  const stats = archetypeManager.getStats();

  const embed = new EmbedBuilder()
    .setTitle('📊 Archetype Coverage Statistics')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Total Archetypes', value: stats.totalArchetypes.toString(), inline: true },
      { name: 'Leader Mappings', value: stats.totalMappings.toString(), inline: true },
      { name: 'With Teammate Abilities', value: stats.archetypesWithTeammates.toString(), inline: true },
      { 
        name: 'Avg Abilities/Archetype', 
        value: stats.averageAbilities.toFixed(1), 
        inline: true 
      }
    );

  // Mode breakdown
  const modeLines = Object.entries(stats.modesBreakdown)
    .sort(([, a], [, b]) => b - a)
    .map(([mode, count]) => `${mode}: ${count}`);
  
  embed.addFields({
    name: 'Mode Coverage',
    value: modeLines.join('\n') || 'None',
  });

  await interaction.reply({ embeds: [embed] });
}

// Autocomplete handler for archetype IDs
export async function autocomplete(interaction: any): Promise<void> {
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const archetypes = archetypeManager.getAll();
  
  const filtered = archetypes
    .filter(a => 
      a.id.toLowerCase().includes(focusedValue) ||
      a.displayName.toLowerCase().includes(focusedValue)
    )
    .slice(0, 25)
    .map(a => ({
      name: `${a.displayName} (${a.id})`,
      value: a.id,
    }));

  await interaction.respond(filtered);
}
