import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  InteractionReplyOptions,
} from 'discord.js';
import { UniqueDefensiveSquad } from '../../types/gacStrategyTypes';
import { GacCounterSquad } from '../../types/swgohGgTypes';

export const CUSTOM_IDS = {
  PICK_DEFENCE_PREFIX: 'gac:offence:pickdef:',
  MARK_USED_PREFIX:    'gac:offence:used:',
  BACK:                'gac:offence:back',
  UNDO:                'gac:offence:undo',
  RESET:               'gac:offence:reset',
  RESET_CONFIRM:       'gac:offence:resetConfirm',
  RESET_CANCEL:        'gac:offence:resetCancel',
  REFRESH:             'gac:offence:refresh',
} as const;

const COLOR_OK = 0x4caf50;
const COLOR_WARN = 0xffaa00;
const COLOR_ERROR = 0xff5555;
const RECENT_BANNER = '⚠️ Showing recent-round defences — your opponent may have placed differently this round.';

export interface OpponentListViewArgs {
  opponentName: string;
  round: number;
  format: '5v5' | '3v3';
  usedCount: number;
  eligibleCount: number;
  opponentDefences: UniqueDefensiveSquad[];
  historyDepth: number;
  errorBanner: string | null;
  displayName: (baseId: string) => string;
}

export function buildOpponentListView(args: OpponentListViewArgs): InteractionReplyOptions {
  const embed = new EmbedBuilder()
    .setTitle(`You vs ${args.opponentName} · Round ${args.round} · ${args.format}`)
    .setColor(args.errorBanner ? COLOR_WARN : COLOR_OK);

  const lines: string[] = [];
  lines.push(`Used so far: ${args.usedCount}/${args.eligibleCount} GAC-eligible chars`, '');
  lines.push(RECENT_BANNER, '');
  if (args.errorBanner) lines.push(`⚠️ ${args.errorBanner}`, '');
  if (args.opponentDefences.length === 0) {
    lines.push(`No recent defences found for ${args.opponentName}. They may not have a public GAC history yet.`);
  } else {
    lines.push('Pick a defence to counter:');
  }
  embed.setDescription(lines.join('\n'));

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (args.opponentDefences.length > 0) {
    let row = new ActionRowBuilder<ButtonBuilder>();
    let inRow = 0;
    for (const def of args.opponentDefences) {
      if (inRow === 5) { components.push(row); row = new ActionRowBuilder<ButtonBuilder>(); inRow = 0; }
      row.addComponents(new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.PICK_DEFENCE_PREFIX}${def.leader.baseId}`)
        .setLabel(args.displayName(def.leader.baseId).slice(0, 80))
        .setStyle(ButtonStyle.Primary));
      inRow++;
    }
    if (inRow > 0) components.push(row);
  }

  const toolbar = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.UNDO)
      .setLabel('↺ Undo last').setStyle(ButtonStyle.Secondary)
      .setDisabled(args.historyDepth === 0),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.RESET)
      .setLabel('↻ Reset all used').setStyle(ButtonStyle.Danger)
      .setDisabled(args.usedCount === 0),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.REFRESH)
      .setLabel('⟳ Refresh').setStyle(ButtonStyle.Secondary),
  );
  components.push(toolbar);

  return { embeds: [embed], components, ephemeral: true };
}

export interface CounterListViewArgs {
  defenceLeader: string;
  defenceLeaderDisplay: string;
  counters: GacCounterSquad[];
  historyDepth: number;
  hasUsed: boolean;
  displayName: (baseId: string) => string;
}

export function buildCounterListView(args: CounterListViewArgs): InteractionReplyOptions {
  const embed = new EmbedBuilder()
    .setTitle(`Top 5 counters for ${args.defenceLeaderDisplay}`)
    .setColor(COLOR_OK);

  const lines: string[] = [RECENT_BANNER, ''];
  if (args.counters.length === 0) {
    lines.push('No counters available — your remaining roster can\'t field a complete team for this defence.');
  } else {
    lines.push('(filtered by your available characters)', '');
    args.counters.forEach((c, i) => {
      const team = [c.leader.baseId, ...c.members.map(m => m.baseId)]
        .map(args.displayName).join(' · ');
      lines.push(`**${i + 1}.** ${team}`);
    });
  }
  embed.setDescription(lines.join('\n'));

  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (args.counters.length > 0) {
    let row = new ActionRowBuilder<ButtonBuilder>();
    let inRow = 0;
    args.counters.forEach((c, i) => {
      if (inRow === 5) { components.push(row); row = new ActionRowBuilder<ButtonBuilder>(); inRow = 0; }
      row.addComponents(new ButtonBuilder()
        .setCustomId(`${CUSTOM_IDS.MARK_USED_PREFIX}${args.defenceLeader}:${c.leader.baseId}`)
        .setLabel(`Used #${i + 1}`).setStyle(ButtonStyle.Success));
      inRow++;
    });
    if (inRow > 0) components.push(row);
  }

  const toolbar = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.BACK).setLabel('← Back').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.UNDO).setLabel('↺ Undo last')
      .setStyle(ButtonStyle.Secondary).setDisabled(args.historyDepth === 0),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.RESET).setLabel('↻ Reset all used')
      .setStyle(ButtonStyle.Danger).setDisabled(!args.hasUsed),
  );
  components.push(toolbar);

  return { embeds: [embed], components, ephemeral: true };
}

export function buildResetConfirmView(): InteractionReplyOptions {
  const embed = new EmbedBuilder()
    .setTitle('Reset all used characters for this round?')
    .setDescription('This clears your used-character set for the current round only. Stored history is wiped.')
    .setColor(COLOR_WARN);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(CUSTOM_IDS.RESET_CONFIRM).setLabel('Yes, reset').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CUSTOM_IDS.RESET_CANCEL).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row], ephemeral: true };
}

export function buildErrorView(message: string): InteractionReplyOptions {
  const embed = new EmbedBuilder()
    .setTitle('Couldn\'t run /gac offence')
    .setDescription(message)
    .setColor(COLOR_ERROR);
  return { embeds: [embed], ephemeral: true };
}
