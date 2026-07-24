/**
 * English dictionary.
 *
 * Annotated `: Dictionary` on purpose — that annotation is what makes a
 * missing or misspelled key a build failure rather than a blank label
 * discovered in production. Do not replace it with an inferred type or
 * widen it; the guarantee disappears silently if you do.
 *
 * Copy here is the original English text lifted verbatim from the
 * components during migration, so switching to English reproduces the
 * pre-i18n interface exactly.
 */

import type { Dictionary } from './es';

export const en: Dictionary = {
  common: {
    active: 'Active',
    user: 'User',
    avatar: 'Avatar',
    profile: 'Profile',
    settings: 'Settings',
    signOut: 'Sign out',
    total: 'Total',
  },

  nav: {
    brand: 'CRM Template for WhatsApp',
    primary: 'Primary',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
    openAccountMenu: 'Open account menu',
    beta: 'Beta',
    betaFeature: 'Beta feature',
    dashboard: 'Dashboard',
    inbox: 'Inbox',
    notifications: 'Notifications',
    contacts: 'Contacts',
    pipelines: 'Pipelines',
    broadcasts: 'Broadcasts',
    automations: 'Automations',
    flows: 'Flows',
    agents: 'AI Agents',
    settings: 'Settings',
    unreadConversations: {
      one: '{count} unread conversation',
      other: '{count} unread conversations',
    },
    unreadNotifications: {
      one: '{count} unread notification',
      other: '{count} unread notifications',
    },
    roles: {
      owner: 'Owner',
      admin: 'Admin',
      agent: 'Agent',
      viewer: 'Viewer',
    },
  },

  modeToggle: {
    switchToLight: 'Switch to light mode',
    switchToDark: 'Switch to dark mode',
  },

  auth: {
    email: 'Email',
    emailPlaceholder: 'you@example.com',
    password: 'Password',
    backToSignIn: 'Back to sign in',
    checkEmail: 'Check your email',

    login: {
      title: 'Welcome back',
      description: 'Sign in to your account',
      inviteTitle: 'Sign in to accept',
      inviteDescription: "Sign in and we'll take you to the invitation.",
      passwordPlaceholder: 'Enter your password',
      forgotPassword: 'Forgot password?',
      submit: 'Sign in',
      submitting: 'Signing in...',
      noAccount: "Don't have an account?",
      createAccount: 'Create account',
    },

    signup: {
      title: 'Create account',
      description: 'Get started with CRM Template for WhatsApp',
      inviteTitle: 'Create account & join',
      inviteDescription:
        'Verify your email, then accept the invitation to join your team.',
      fullName: 'Full name',
      fullNamePlaceholder: 'John Doe',
      passwordPlaceholder: 'At least 6 characters',
      confirmPassword: 'Confirm password',
      confirmPasswordPlaceholder: 'Repeat your password',
      submit: 'Create account',
      submitting: 'Creating account...',
      haveAccount: 'Already have an account?',
      signIn: 'Sign in',
      passwordsDoNotMatch: 'Passwords do not match',
      passwordTooShort: 'Password must be at least 6 characters',
      confirmationSentLead: "We've sent a confirmation link to",
      confirmationSentTrail:
        '. Please check your inbox and click the link to verify your account.',
    },

    forgotPassword: {
      title: 'Reset password',
      description: "Enter your email and we'll send you a reset link",
      submit: 'Send reset link',
      submitting: 'Sending...',
      resetSentLead: "We've sent a password reset link to",
      resetSentTrail: '. Please check your inbox.',
    },
  },

  dashboard: {
    title: 'Dashboard',
    subtitle:
      'Live analytics across conversations, contacts, deals, broadcasts, and automations.',

    metrics: {
      activeConversations: 'Active Conversations',
      newContactsToday: 'New Contacts Today',
      openDealsValue: 'Open Deals Value',
      messagesSentToday: 'Messages Sent Today',
      openDeals: {
        one: '{count} open deal',
        other: '{count} open deals',
      },
      noChange: 'No change {suffix}',
      delta: '{value} {suffix}',
      vsYesterday: 'vs yesterday',
      newTodayVsYesterday: 'new today vs yesterday',
    },

    quickActions: {
      newContact: 'New Contact',
      newDeal: 'New Deal',
      newBroadcast: 'New Broadcast',
      newAutomation: 'New Automation',
    },

    conversationsChart: {
      title: 'Conversations Over Time',
      subtitle: 'Daily message volume by direction',
      rangeDays: '{count} days',
      emptyTitle: 'No message activity in this range',
      emptyHint: 'Send or receive messages to start populating this chart.',
      incoming: 'Incoming',
      outgoing: 'Outgoing',
      ariaLabel: 'Conversations per day',
    },

    pipeline: {
      title: 'Pipeline Value',
      subtitle: 'Open deals by stage',
      emptyTitle: 'No open deals yet',
      emptyHint: 'Create deals in Pipelines to see stage breakdowns here.',
      ariaLabel: 'Pipeline value by stage',
      deals: {
        one: '{count} deal',
        other: '{count} deals',
      },
    },

    responseTime: {
      title: 'Average First Response Time',
      subtitle:
        "Minutes to reply to a customer's first unreplied message, by weekday",
      category: 'Avg minutes',
      target: 'target {minutes}m',
      thisWeek: 'This week:',
      lastWeek: 'Last week:',
      emptyTitle: 'No replies recorded yet',
      emptyHint: 'This chart fills in as you reply to customer messages.',
    },

    activity: {
      title: 'Recent Activity',
      viewAll: 'View all →',
      emptyTitle: 'No activity yet',
      emptyHint:
        'Activity from messages, deals, broadcasts, and automations will appear here.',
      showing: 'Showing {visible} of {total}',
      show: 'Show',
      unknownContact: 'Unknown',
      someContact: 'a contact',
      unnamedAutomation: 'Automation',
      message: 'New message from {who}',
      contact: 'New contact: {who}',
      dealInStage: 'Deal "{title}" in {stage}',
      dealUpdated: 'Deal "{title}" updated',
      broadcastSent: 'Broadcast "{name}" sent to {count} contacts',
      broadcastOther: 'Broadcast "{name}" {status} ({count} recipients)',
      automationTriggered: 'Automation "{name}" triggered for {who}',
      automationFailed: 'Automation "{name}" failed for {who}',
    },

    emptyState: {
      notEnoughData: 'Not enough data yet',
    },
  },

  settings: {
    appearance: {
      title: 'Appearance',
      description:
        'Set the mode, accent colour and language used across the app. Saved to this device — try it, it changes live.',
      mode: 'Mode',
      colorMode: 'Color mode',
      useMode: 'Use {mode} mode',
      light: 'Light',
      dark: 'Dark',
      accentColor: 'Accent color',
      useTheme: 'Use {name} theme',
      themeId: 'Theme id: {id}',
      language: 'Language',
      languageGroup: 'Interface language',
      useLanguage: 'Use {name}',
      themes: {
        violet: {
          name: 'Violet',
          tagline: 'The default — confident, slightly playful.',
        },
        emerald: {
          name: 'Emerald',
          tagline:
            'Growth-coded, nods at messaging without copying WhatsApp green.',
        },
        cobalt: {
          name: 'Cobalt',
          tagline: 'Clean B2B-SaaS blue — calm and product-y.',
        },
        amber: {
          name: 'Amber',
          tagline: 'Warm and friendly — feels good for SMB teams.',
        },
        rose: {
          name: 'Rose',
          tagline: 'Bold and modern — D2C, creator-economy, lifestyle.',
        },
      },
    },
  },
};
