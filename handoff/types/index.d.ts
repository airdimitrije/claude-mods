export type Offer = { tokens: number; path: string } | null

declare module 'claude-code' {
  interface PluginState {
    handoff: {
      // The band's offer: shown above the prompt while set
      offer: Offer
      // Context size at which the band was last waved off, so it waits for real growth
      dismissedAt: number
    }
  }
}
