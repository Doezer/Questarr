import { randomUUID } from "node:crypto";
import { storage } from "./storage.js";
import { notifyUser } from "./socket.js";
import { localDayNumber, type PlayStatsZone } from "../shared/play-stats.js";
import {
  currentPeriod,
  generateQuests,
  monthBacklogProgress,
  periodFromStart,
  QUEST_PERIODS,
  questProgress,
  unlockedMedals,
  type QuestKind,
  type QuestPeriod,
} from "../shared/quests.js";
import type { Quest } from "../shared/schema.js";

/** A quest with the title of the game it is about, when it is about one. */
export type QuestView = Quest & { gameTitle: string | null };

export interface QuestsResponse {
  enabled: boolean;
  current: QuestView[];
  history: QuestView[];
  medals: string[];
  /** The month's backlog progress: games completed out of the games that were in the backlog. */
  backlogProgress: { completed: number; total: number; percent: number } | null;
}

const HISTORY_LIMIT = 30;

interface SettleContext {
  userId: string;
  zone: PlayStatsZone;
  now: Date;
  today: number;
  games: Parameters<typeof questProgress>[1];
  eventInputs: Parameters<typeof questProgress>[2];
  sessionInputs: Parameters<typeof questProgress>[3];
}

/** Brings one quest up to date, notifying the user when it completes, and returns its new state. */
async function settleQuest(quest: Quest, ctx: SettleContext): Promise<Quest> {
  if (quest.status !== "active") return quest;
  const { userId, zone, now, today } = ctx;
  const period = quest.period as QuestPeriod;
  const progress = Math.min(
    quest.target,
    questProgress(
      {
        kind: quest.kind as QuestKind,
        period,
        periodStart: quest.periodStart,
        gameId: quest.gameId,
      },
      ctx.games,
      ctx.eventInputs,
      ctx.sessionInputs,
      zone
    )
  );
  const ended = today >= periodFromStart(period, quest.periodStart).endDay;
  let status = "active";
  if (progress >= quest.target) status = "completed";
  else if (ended) status = "missed";
  if (progress === quest.progress && status === quest.status) return quest;

  const completedAt = status === "completed" ? now : null;
  const changed = await storage.updateQuest(quest.id, { progress, status, completedAt });
  if (!changed) {
    // Another sync already settled this quest; show what is stored.
    const stored = (await storage.getUserQuests(userId)).find((q) => q.id === quest.id);
    return stored ?? quest;
  }
  if (status === "completed") {
    const notification = await storage.addNotification({
      userId,
      type: "success",
      title: "Quest completed",
      message: `You completed a ${quest.period === "week" ? "weekly" : "monthly"} backlog quest.`,
      link: "/stats",
    });
    notifyUser("notification", notification, userId);
  }
  return { ...quest, progress, status, completedAt };
}

/**
 * Makes sure the current week and month have their quests, brings the open ones up to date
 * (completed, or missed once their period is over) and returns what the quest card shows.
 */
export async function syncQuests(
  userId: string,
  zone: PlayStatsZone,
  now: Date = new Date()
): Promise<QuestsResponse> {
  const settings = await storage.getUserSettings(userId);
  if (settings && settings.questsEnabled === false) {
    return { enabled: false, current: [], history: [], medals: [], backlogProgress: null };
  }

  const [games, events, sessions, existing] = await Promise.all([
    storage.getUserGames(userId, true),
    storage.getUserGameStatusEvents(userId),
    storage.getUserPlaySessions(userId),
    storage.getUserQuests(userId),
  ]);
  const eventInputs = events.map((e) => ({ gameId: e.gameId, status: e.status, at: e.createdAt }));
  const sessionInputs = sessions.map((s) => ({ gameId: s.gameId, startedAt: s.startedAt }));

  const today = localDayNumber(zone)(now);
  const periods = QUEST_PERIODS.map((p) => currentPeriod(p, now, zone));
  const created = periods.flatMap((p) => {
    if (existing.some((q) => q.period === p.period && q.periodStart === p.start)) return [];
    return generateQuests(userId, games, p, zone).map((draft) => ({
      id: randomUUID(),
      userId,
      period: draft.period,
      periodStart: draft.periodStart,
      kind: draft.kind,
      gameId: draft.gameId,
      target: draft.target,
    }));
  });
  await storage.addQuests(created);
  const all = created.length > 0 ? await storage.getUserQuests(userId) : existing;

  const synced: Quest[] = [];
  for (const quest of all) {
    synced.push(
      await settleQuest(quest, { userId, zone, now, today, games, eventInputs, sessionInputs })
    );
  }

  const currentStarts = new Set(periods.map((p) => `${p.period}:${p.start}`));
  const isCurrent = (q: Quest): boolean => currentStarts.has(`${q.period}:${q.periodStart}`);
  const titleById = new Map(games.map((g) => [g.id, g.title]));
  const view = (q: Quest): QuestView => ({
    ...q,
    gameTitle: q.gameId ? (titleById.get(q.gameId) ?? null) : null,
  });
  const medals = unlockedMedals(
    synced.filter((q) => q.status === "completed").map((q) => q.kind as QuestKind)
  );

  return {
    enabled: true,
    current: synced.filter(isCurrent).map(view),
    history: synced
      .filter((q) => !isCurrent(q))
      .slice(0, HISTORY_LIMIT)
      .map(view),
    medals,
    backlogProgress: monthBacklogProgress(games, eventInputs, now, zone),
  };
}
