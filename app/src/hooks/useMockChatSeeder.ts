'use client'

import { useEffect } from 'react'

import { isFeatureEnabled } from '@/lib/features'
import { useStreamingConversationStore } from '@/stores/useStreamingConversationStore'
import type { ChatMessage } from '@/stores/useStreamingConversationStore.types'

const t0 = (daysAgo: number, h: number, m: number): Date =>
  new Date(Date.UTC(2026, 0, 16 - daysAgo, h, m, 0))

const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  sarahcandle01: [
    {
      id: 'seed_sc_1',
      role: 'user',
      content: "Build me a website for my handmade candle business. I want it to feel warm and premium — cozy tones, beautiful product photography, and a way to browse by scent.",
      timestamp: t0(6, 14, 22),
    },
    {
      id: 'seed_sc_2',
      role: 'assistant',
      content: "Building Sarah's Candle Shop! I'm creating a full homepage with a dramatic hero section, a 6-product grid with warm lifestyle photography, a scent variant picker, and a featured Winter Collection section. Filling in the product details now...",
      timestamp: t0(6, 14, 23),
    },
    {
      id: 'seed_sc_3',
      role: 'user',
      content: "Love it! Can you make the product cards more interactive and make sure scrolling feels smooth?",
      timestamp: t0(6, 14, 35),
    },
    {
      id: 'seed_sc_4',
      role: 'assistant',
      content: "Done! Cards now lift smoothly on hover with a soft shadow, and I've added a subtle zoom on the product images. Fixed the scroll behavior so the whole page flows naturally. The scent variant picker has a frosted glass look now too — feels a lot more premium.",
      timestamp: t0(6, 14, 36),
    },
    {
      id: 'seed_sc_5',
      role: 'user',
      content: "Can you add a sticky nav and make the color palette warmer?",
      timestamp: t0(5, 10, 8),
    },
    {
      id: 'seed_sc_6',
      role: 'assistant',
      content: "Done! Nav is now sticky at the top so it stays visible while scrolling. I've also warmed up the palette — deeper ambers, a richer background for the featured section, and softer gold accents on the badges. Looks really cohesive now.",
      timestamp: t0(5, 10, 9),
    },
  ],
  benbakery01: [
    {
      id: 'seed_bb_1',
      role: 'user',
      content: "Create a website for my artisan bakery. Rustic but polished — real photos of the bread and pastries, and make it feel warm and appetizing.",
      timestamp: t0(4, 9, 15),
    },
    {
      id: 'seed_bb_2',
      role: 'assistant',
      content: "Building Ben's Bakery! Setting up a warm homepage with a photo-forward hero, a category strip for browsing by type, and a best-sellers grid with 6 of your top products. Using real bakery photography throughout — sourdough, croissants, cinnamon rolls, chocolate cake, and more.",
      timestamp: t0(4, 9, 16),
    },
    {
      id: 'seed_bb_3',
      role: 'user',
      content: "Perfect. Can you highlight the sourdough loaf as a featured item and add a specials section?",
      timestamp: t0(4, 9, 28),
    },
    {
      id: 'seed_bb_4',
      role: 'assistant',
      content: "Done! Created a full featured section spotlighting the sourdough loaf with a large image, tasting notes, and an order button. Added a 'Today's Specials' strip below the best sellers. Also put a trust bar at the top — 200+ loaves baked fresh every morning.",
      timestamp: t0(4, 9, 29),
    },
    {
      id: 'seed_bb_5',
      role: 'user',
      content: "Make the order button more visible and add pre-order functionality to the specials.",
      timestamp: t0(3, 11, 44),
    },
    {
      id: 'seed_bb_6',
      role: 'assistant',
      content: "Done! The order button is now larger and uses a stronger gold color so it pops on both light and dark backgrounds. Added pre-order labels to the specials strip — limited quantities messaging is live too. Should drive more conversions.",
      timestamp: t0(3, 11, 45),
    },
  ],
  marcospizza01: [
    {
      id: 'seed_mp_1',
      role: 'user',
      content: "Build a website for my pizzeria. Classic Italian, been open since 1987. Dark and authentic, real food photos, full menu.",
      timestamp: t0(2, 16, 45),
    },
    {
      id: 'seed_mp_2',
      role: 'assistant',
      content: "Building Marco's Pizza! Going with a dark Italian restaurant aesthetic — deep reds on charcoal, a dramatic hero with your signature pizza, and a menu section with tab navigation across Pizzas, Pasta, and Sides. Adding your founding story in a featured mid-page section.",
      timestamp: t0(2, 16, 46),
    },
    {
      id: 'seed_mp_3',
      role: 'user',
      content: "Add the full pizza menu and a daily specials section. And make the Order Now button way more visible.",
      timestamp: t0(2, 16, 58),
    },
    {
      id: 'seed_mp_4',
      role: 'assistant',
      content: "Done! Added 6 menu items across categories — Margherita, Diavola, and Truffle Bianca pizzas plus Cacio e Pepe and Arrabbiata pasta. Daily specials scroll horizontally so you can add as many as you want. The Order Now button is now bigger and pinned in the hero — impossible to miss.",
      timestamp: t0(2, 17, 0),
    },
    {
      id: 'seed_mp_5',
      role: 'user',
      content: "Love the specials strip. Can you add ingredient tags to the pizzas and a ribbon banner at the top?",
      timestamp: t0(1, 13, 20),
    },
    {
      id: 'seed_mp_6',
      role: 'assistant',
      content: "Done! Each pizza card now has ingredient tags — Mozz, Basil, San Marzano, etc. Added a red announcement ribbon at the top: 'Now open for online ordering — free delivery on orders over $30'. Gives the whole site a lot more personality.",
      timestamp: t0(1, 13, 21),
    },
  ],
}

export function useMockChatSeeder(appId: string | null): void {
  useEffect(() => {
    if (!isFeatureEnabled.mockLogin()) return
    if (!appId) return

    const store = useStreamingConversationStore.getState()

    if (!store.historyLoadingComplete) {
      store.setHistoryLoadingComplete(true)
    }

    if (store.messages.length > 0) return

    const messages: ChatMessage[] | undefined = SEED_MESSAGES[appId]
    if (!messages) return

    messages.forEach((msg: ChatMessage) => store.addCompletedMessage(msg))
  }, [appId])
}
