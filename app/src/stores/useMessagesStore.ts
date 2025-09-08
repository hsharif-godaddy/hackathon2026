import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { 
  handleSendMessage as sendMessage, 
  cleanup as cleanupMessageService,
  loadConversations,
  loadConversation
} from '@/app/develop/components/messageService'
import { Message, PlanItem, AiEditContext } from '@/app/develop/components/types'

interface Conversation {
  id: string
  updatedAt: string
}

// Initialization options interfaces for better type safety
interface AppInitData {
  initialBuildComplete?: boolean
}

interface SiteInitData {
  initial_prompt?: string
  status?: string
}

interface ConversationInitOptions {
  appData?: AppInitData
  siteData?: SiteInitData
}

interface MessagesStore {
  // Current context
  currentAppId: string | null
  
  // Messages & Conversations
  messages: Message[]
  conversations: Conversation[]
  conversationId: string | null
  isLoading: boolean
  inputValue: string
  
  // Development plan
  developmentPlan: PlanItem[]
  
  // AI edit context
  aiEditContext: AiEditContext | null
  
  // Loading states
  isLoadingConversations: boolean
  
  // Actions
  setCurrentAppId: (appId: string | null) => void
  setInputValue: (value: string) => void
  setMessages: (messages: Message[]) => void
  setIsLoading: (loading: boolean) => void
  setAiEditContext: (context: AiEditContext | null) => void
  
  // Core message operations
  initializeConversations: (appId: string, options?: ConversationInitOptions) => Promise<void>
  handleSendMessage: (messageContent?: string) => Promise<void>
  cleanup: () => void
}

export const useMessagesStore = create<MessagesStore>()(
  immer((set, get) => ({
    // Initial state
    currentAppId: null,
    messages: [],
    conversations: [],
    conversationId: null,
    isLoading: false,
    inputValue: '',
    developmentPlan: [],
    aiEditContext: null,
    isLoadingConversations: false,
    
    // Simple setters
    setCurrentAppId: (appId) => set((state) => { state.currentAppId = appId }),
    setInputValue: (value) => set((state) => { state.inputValue = value }),
    setMessages: (messages) => set((state) => { state.messages = messages }),
    setIsLoading: (loading) => set((state) => { state.isLoading = loading }),
    setAiEditContext: (context) => set((state) => { state.aiEditContext = context }),
    
    // Initialize conversations for an app
    initializeConversations: async (appId: string, options?: ConversationInitOptions) => {
      const { appData, siteData } = options || {}
      console.log('🔧 initializeConversations called with appId:', appId)
      set((state) => {
        console.log('🔧 Setting currentAppId in store:', appId)
        state.currentAppId = appId
        state.isLoadingConversations = true
        // Force reset conversation state for new app
        state.conversationId = null
        state.messages = []
      })
      
      try {
        console.log('💬 Loading conversations for app:', appId)
        
        const conversationList = await loadConversations(appId)
        console.log('📋 Loaded conversations:', conversationList)
        if (process.env.NODE_ENV === 'development') {
          console.log('📋 Conversations details:', {
            conversationList,
            length: conversationList?.length,
            isArray: Array.isArray(conversationList),
            type: typeof conversationList
          })
        }
        
        set((state) => {
          state.conversations = conversationList || []
        })
        
        // Load most recent conversation for THIS app if available
        if (conversationList && conversationList.length > 0) {
          const mostRecent = conversationList[0]
          console.log('📥 Loading conversation for app:', appId, 'conversation:', mostRecent.id)
          
          // Double-check that this conversation belongs to the current app
          if (mostRecent.appId !== appId) {
            console.error('🚨 Conversation app mismatch! Expected:', appId, 'Got:', mostRecent.appId)
            return
          }
          
          const conversationData = await loadConversation(appId, mostRecent.id)
          
          if (conversationData) {
            console.log('📨 Setting messages from conversation:', conversationData.messages?.length || 0, conversationData.messages)
            set((state) => {
              state.messages = conversationData.messages
              state.conversationId = mostRecent.id
            })
            console.log('📱 Messages set in store. Current messages:', get().messages?.length || 0)
          }
        } else {
          console.log('📝 No existing conversations for app:', appId, '- starting fresh')
          console.log('🔍 Initial prompt evaluation:', {
            hasInitialPrompt: !!siteData?.initial_prompt,
            siteStatus: siteData?.status,
            hasAppData: !!appData,
            initialBuildComplete: appData?.initialBuildComplete,
            shouldSetPrompt: siteData?.initial_prompt && 
                            siteData?.status === 'running' &&
                            appData && 
                            !appData.initialBuildComplete
          })
          
          // Handle initial prompt for new/incomplete builds
          if (siteData?.initial_prompt && 
              siteData?.status === 'running' &&
              appData && 
              !appData.initialBuildComplete) {
            console.log('📝 Setting initial prompt for incomplete build:', siteData.initial_prompt)
            set((state) => {
              state.inputValue = siteData.initial_prompt!
            })
          } else {
            console.log('✅ NOT setting initial prompt (build complete or other conditions not met)')
          }
        }
        
        console.log('✅ Conversations loaded successfully')
        
      } catch (error) {
        console.error('❌ Failed to load conversations:', error)
      } finally {
        set((state) => {
          state.isLoadingConversations = false
          // CRITICAL: Reset main isLoading state after initialization
          // This fixes the issue where auto-send was blocked by stuck loading state
          state.isLoading = false
        })
        
        // Debug: Show final state after initialization
        const finalState = get()
        console.log('🔍 Final state after initializeConversations:', {
          currentAppId: finalState.currentAppId,
          conversationsCount: finalState.conversations?.length,
          messagesCount: finalState.messages?.length,
          isLoading: finalState.isLoading,
          inputValue: finalState.inputValue
        })
      }
    },
    
    // Send message handler
    handleSendMessage: async (messageContent?: string) => {
      const { inputValue, isLoading, currentAppId, conversationId, aiEditContext } = get()
      const content = messageContent || inputValue
      
      console.log('🚀 handleSendMessage called:', {
        content: content?.slice(0, 50) + '...',
        contentLength: content?.length,
        inputValue: inputValue?.slice(0, 50) + '...',
        isLoading,
        currentAppId,
        conversationId,
        hasContent: !!content?.trim()
      })
      
      if (!content.trim()) {
        console.log('❌ Message rejected: no content')
        return
      }
      
      if (isLoading) {
        console.log('❌ Message rejected: already loading')
        return
      }
      
      if (!currentAppId) {
        console.log('❌ Message rejected: no currentAppId')
        return
      }
      
      console.log('✅ Message validation passed, proceeding to send...')
      
      await sendMessage({
        messageContent: content,
        inputValue: get().inputValue,
        isLoading: get().isLoading,
        appId: currentAppId,
        conversationId: conversationId || undefined,
        aiEditContext,
        setMessages: (value) => {
          if (typeof value === 'function') {
            const currentMessages = get().messages
            const newMessages = value(currentMessages)
            get().setMessages(newMessages)
          } else {
            console.log('📨 Direct setting messages:', value.length)
            get().setMessages(value)
          }
        },
        setInputValue: (value) => {
          if (typeof value === 'function') {
            const currentValue = get().inputValue
            set((state) => { state.inputValue = value(currentValue) })
          } else {
            set((state) => { state.inputValue = value })
          }
        },
        setIsLoading: (value) => {
          if (typeof value === 'function') {
            const currentLoading = get().isLoading
            get().setIsLoading(value(currentLoading))
          } else {
            get().setIsLoading(value)
          }
        },
        setConversationId: (value) => {
          if (typeof value === 'function') {
            const currentId = get().conversationId
            set((state) => { state.conversationId = value(currentId) })
          } else {
            set((state) => { state.conversationId = value })
          }
        },
        setDevelopmentPlan: (plan: PlanItem[]) => set((state) => { state.developmentPlan = plan }),
        setConversations: (conversations: Conversation[]) => set((state) => { state.conversations = conversations }),
      })
      
      // Don't clear input here - messageService.ts already handles it on line 175
      // This was causing a race condition where input would get stuck
      set((state) => {
        state.aiEditContext = null
      })
    },
    
    // Cleanup when leaving app
    cleanup: () => {
      const { currentAppId } = get()
      
      console.log('🧹 cleanup() called for currentAppId:', currentAppId)
      
      if (currentAppId) {
        cleanupMessageService(currentAppId)
      }
      
      // Reset all message state
      set((state) => {
        console.log('🧹 Resetting all message state, currentAppId was:', state.currentAppId)
        state.currentAppId = null
        state.messages = []
        state.conversations = []
        state.conversationId = null
        state.inputValue = ''
        state.aiEditContext = null
        state.developmentPlan = []
        state.isLoading = false
        state.isLoadingConversations = false
      })
    }
  }))
)

// Cleanup helper for useEffect
export const cleanupMessagesStore = () => {
  useMessagesStore.getState().cleanup()
}
