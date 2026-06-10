/** Curated starter prompts shown on the landing composer (tuned for demo wow). */
export interface StarterPrompt {
  emoji: string;
  title: string;
  prompt: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    emoji: "✅",
    title: "Todo app with streaks",
    prompt:
      "Create a beautiful todo app with a daily streak counter, satisfying check animations, and a clean home screen showing today's tasks grouped by morning/afternoon/evening.",
  },
  {
    emoji: "🧘",
    title: "Meditation timer",
    prompt:
      "Build a calm meditation app with a breathing timer, a library of sessions, a soft gradient home screen, and a progress tab showing minutes meditated this week.",
  },
  {
    emoji: "🍳",
    title: "Recipe finder",
    prompt:
      "Design a recipe discovery app with a featured recipe hero, category chips, a grid of recipe cards with photos, and a detail screen with ingredients and steps.",
  },
  {
    emoji: "💸",
    title: "Expense tracker",
    prompt:
      "Make a personal finance app with a balance hero card, a weekly spending chart, a categorized transactions list, and an add-expense flow.",
  },
  {
    emoji: "🏃",
    title: "Run tracker",
    prompt:
      "Create a running app with a start-run hero, a stats screen (distance, pace, calories), a map placeholder, and a history of past runs with medals.",
  },
  {
    emoji: "🎵",
    title: "Music player",
    prompt:
      "Build a music player with a now-playing screen with album art and controls, a playlists tab, and a discovery feed of curated playlists.",
  },
];
