/**
 * Spanish dictionary — the default locale, and the source of truth for
 * the dictionary's shape.
 *
 * `Dictionary` is derived from this object, and every other locale is
 * declared as that type (see `en.ts`). A key added here does not
 * compile until every locale supplies it, and a key misspelled at a
 * call site does not compile either. That is the whole reason these
 * are `.ts` modules rather than the `.json` files the Next.js i18n
 * guide uses — JSON gives no such guarantee, and a missing translation
 * would surface as blank text in production instead of a failed build.
 *
 * Deliberately NOT `as const`: that would infer literal types
 * (`'Panel'` rather than `string`) and force every other locale to
 * repeat the Spanish text verbatim. Without it, values widen to
 * `string` while the key structure stays exact — which is the part we
 * actually want enforced.
 *
 * Namespaces mirror the migration phases, so each later phase adds one
 * top-level key rather than editing existing ones. Screens not yet
 * migrated keep their inline English and are simply absent here.
 */

export const es = {
  common: {
    active: 'Activo',
    user: 'Usuario',
    avatar: 'Avatar',
    profile: 'Perfil',
    settings: 'Ajustes',
    signOut: 'Cerrar sesión',
    total: 'Total',
  },

  nav: {
    brand: 'Plantilla CRM para WhatsApp',
    primary: 'Principal',
    openMenu: 'Abrir menú',
    closeMenu: 'Cerrar menú',
    openAccountMenu: 'Abrir menú de cuenta',
    beta: 'Beta',
    betaFeature: 'Función en beta',
    dashboard: 'Panel',
    inbox: 'Bandeja',
    notifications: 'Notificaciones',
    contacts: 'Contactos',
    pipelines: 'Embudos',
    broadcasts: 'Difusiones',
    automations: 'Automatizaciones',
    flows: 'Flujos',
    agents: 'Agentes IA',
    settings: 'Ajustes',
    unreadConversations: {
      one: '{count} conversación sin leer',
      other: '{count} conversaciones sin leer',
    },
    unreadNotifications: {
      one: '{count} notificación sin leer',
      other: '{count} notificaciones sin leer',
    },
    roles: {
      owner: 'Propietario',
      admin: 'Administrador',
      agent: 'Agente',
      viewer: 'Lector',
    },
  },

  modeToggle: {
    switchToLight: 'Cambiar a modo claro',
    switchToDark: 'Cambiar a modo oscuro',
  },

  auth: {
    email: 'Correo',
    emailPlaceholder: 'tu@ejemplo.com',
    password: 'Contraseña',
    backToSignIn: 'Volver a iniciar sesión',
    checkEmail: 'Revisa tu correo',

    login: {
      title: 'Bienvenido de nuevo',
      description: 'Inicia sesión en tu cuenta',
      inviteTitle: 'Inicia sesión para aceptar',
      inviteDescription: 'Inicia sesión y te llevamos a la invitación.',
      passwordPlaceholder: 'Ingresa tu contraseña',
      forgotPassword: '¿Olvidaste tu contraseña?',
      submit: 'Iniciar sesión',
      submitting: 'Iniciando sesión...',
      noAccount: '¿No tienes una cuenta?',
      createAccount: 'Crear cuenta',
    },

    signup: {
      title: 'Crear cuenta',
      description: 'Comienza con la Plantilla CRM para WhatsApp',
      inviteTitle: 'Crear cuenta y unirse',
      inviteDescription:
        'Verifica tu correo y luego acepta la invitación para unirte a tu equipo.',
      fullName: 'Nombre completo',
      fullNamePlaceholder: 'Juan Pérez',
      passwordPlaceholder: 'Al menos 6 caracteres',
      confirmPassword: 'Confirmar contraseña',
      confirmPasswordPlaceholder: 'Repite tu contraseña',
      submit: 'Crear cuenta',
      submitting: 'Creando cuenta...',
      haveAccount: '¿Ya tienes una cuenta?',
      signIn: 'Iniciar sesión',
      passwordsDoNotMatch: 'Las contraseñas no coinciden',
      passwordTooShort: 'La contraseña debe tener al menos 6 caracteres',
      // Split around the styled email address rather than interpolated,
      // so the address keeps its own emphasis in the rendered sentence.
      confirmationSentLead: 'Enviamos un enlace de confirmación a',
      confirmationSentTrail:
        '. Revisa tu bandeja de entrada y haz clic en el enlace para verificar tu cuenta.',
    },

    forgotPassword: {
      title: 'Restablecer contraseña',
      description: 'Ingresa tu correo y te enviaremos un enlace para restablecerla',
      submit: 'Enviar enlace',
      submitting: 'Enviando...',
      resetSentLead: 'Enviamos un enlace para restablecer tu contraseña a',
      resetSentTrail: '. Revisa tu bandeja de entrada.',
    },
  },

  dashboard: {
    title: 'Panel',
    subtitle:
      'Analítica en vivo de conversaciones, contactos, tratos, difusiones y automatizaciones.',

    metrics: {
      activeConversations: 'Conversaciones activas',
      newContactsToday: 'Contactos nuevos hoy',
      openDealsValue: 'Valor de tratos abiertos',
      messagesSentToday: 'Mensajes enviados hoy',
      openDeals: {
        one: '{count} trato abierto',
        other: '{count} tratos abiertos',
      },
      noChange: 'Sin cambios {suffix}',
      delta: '{value} {suffix}',
      vsYesterday: 'vs. ayer',
      newTodayVsYesterday: 'nuevas hoy vs. ayer',
    },

    quickActions: {
      newContact: 'Nuevo contacto',
      newDeal: 'Nuevo trato',
      newBroadcast: 'Nueva difusión',
      newAutomation: 'Nueva automatización',
    },

    conversationsChart: {
      title: 'Conversaciones en el tiempo',
      subtitle: 'Volumen diario de mensajes por dirección',
      rangeDays: '{count} días',
      emptyTitle: 'Sin actividad de mensajes en este rango',
      emptyHint: 'Envía o recibe mensajes para empezar a poblar este gráfico.',
      incoming: 'Entrantes',
      outgoing: 'Salientes',
      ariaLabel: 'Conversaciones por día',
    },

    pipeline: {
      title: 'Valor del embudo',
      subtitle: 'Tratos abiertos por etapa',
      emptyTitle: 'Aún no hay tratos abiertos',
      emptyHint: 'Crea tratos en Embudos para ver el desglose por etapa aquí.',
      ariaLabel: 'Valor del embudo por etapa',
      deals: {
        one: '{count} trato',
        other: '{count} tratos',
      },
    },

    responseTime: {
      title: 'Tiempo promedio de primera respuesta',
      subtitle:
        'Minutos para responder al primer mensaje sin contestar de un cliente, por día de la semana',
      category: 'Minutos promedio',
      target: 'objetivo {minutes} min',
      thisWeek: 'Esta semana:',
      lastWeek: 'Semana pasada:',
      emptyTitle: 'Aún no hay respuestas registradas',
      emptyHint: 'Este gráfico se completa a medida que respondes a los clientes.',
    },

    activity: {
      title: 'Actividad reciente',
      viewAll: 'Ver todo →',
      emptyTitle: 'Aún no hay actividad',
      emptyHint:
        'Aquí aparecerá la actividad de mensajes, tratos, difusiones y automatizaciones.',
      showing: 'Mostrando {visible} de {total}',
      show: 'Mostrar',
      unknownContact: 'Desconocido',
      someContact: 'un contacto',
      unnamedAutomation: 'Automatización',
      // Composed in the component from the parameters `loadActivity`
      // returns. The data layer no longer builds these sentences —
      // see design.md, decision 7.
      message: 'Nuevo mensaje de {who}',
      contact: 'Nuevo contacto: {who}',
      dealInStage: 'Trato "{title}" en {stage}',
      dealUpdated: 'Trato "{title}" actualizado',
      broadcastSent: 'Difusión "{name}" enviada a {count} contactos',
      broadcastOther: 'Difusión "{name}" {status} ({count} destinatarios)',
      automationTriggered: 'Automatización "{name}" activada para {who}',
      automationFailed: 'Automatización "{name}" falló para {who}',
    },

    emptyState: {
      notEnoughData: 'Aún no hay datos suficientes',
    },
  },

  settings: {
    appearance: {
      title: 'Apariencia',
      description:
        'Elige el modo, el color de acento y el idioma de la aplicación. Se guarda en este dispositivo — pruébalo, cambia al instante.',
      mode: 'Modo',
      colorMode: 'Modo de color',
      useMode: 'Usar modo {mode}',
      light: 'Claro',
      dark: 'Oscuro',
      accentColor: 'Color de acento',
      useTheme: 'Usar tema {name}',
      themeId: 'Id del tema: {id}',
      language: 'Idioma',
      languageGroup: 'Idioma de la interfaz',
      useLanguage: 'Usar {name}',
      themes: {
        violet: {
          name: 'Violeta',
          tagline: 'El predeterminado — seguro, con un toque juguetón.',
        },
        emerald: {
          name: 'Esmeralda',
          tagline:
            'Evoca crecimiento y mensajería sin copiar el verde de WhatsApp.',
        },
        cobalt: {
          name: 'Cobalto',
          tagline: 'Azul B2B-SaaS limpio — sobrio y de producto.',
        },
        amber: {
          name: 'Ámbar',
          tagline: 'Cálido y cercano — va bien con equipos pequeños.',
        },
        rose: {
          name: 'Rosa',
          tagline: 'Audaz y moderno — D2C, creadores, lifestyle.',
        },
      },
    },
  },
};

export type Dictionary = typeof es;
