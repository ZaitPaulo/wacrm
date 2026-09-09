import {
  Clock,
  Coins,
  Megaphone,
  FileText,
  Camera,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Store,
  Tags,
  User,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { hasMinRole, type AccountRole } from '@/lib/auth/roles';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'instagram',
  'facebook',
  'templates',
  'quick-replies',
  'business-hours',
  'fields',
  'deals',
  'showcase',
  'members',
  'api',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `adminOnly` items are hidden for non-admins. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  /**
   * Reservada a admin+. Coincide con el grupo `workspace` por
   * construcción: todo lo que configura la cuenta (canales, plantillas,
   * catálogo de campos, vitrina, miembros, API keys) es de administración
   * y su RLS ya rechaza escrituras de un agente. El grupo `account`
   * —perfil, contraseña, apariencia— es de cada quien y queda abierto.
   *
   * `overview` también está marcada: su landing son atajos a las tarjetas
   * del workspace, así que para un agente sería una pantalla de enlaces
   * a lugares donde no puede entrar.
   */
  adminOnly?: boolean;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top', adminOnly: true },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', adminOnly: true },
  instagram: { id: 'instagram', label: 'Instagram', icon: Camera, group: 'workspace', adminOnly: true },
  facebook: { id: 'facebook', label: 'Facebook', icon: Megaphone, group: 'workspace', adminOnly: true },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace', adminOnly: true },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace', adminOnly: true },
  'business-hours': { id: 'business-hours', label: 'Business hours', icon: Clock, group: 'workspace', adminOnly: true },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace', adminOnly: true },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace', adminOnly: true },
  showcase: { id: 'showcase', label: 'Public showcase', icon: Store, group: 'workspace', adminOnly: true },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace', adminOnly: true },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace', adminOnly: true },
};

export const RAIL_GROUPS: { label: string | null; group: SectionMeta['group'] }[] = [
  { label: null, group: 'top' },
  { label: 'Account', group: 'account' },
  { label: 'Workspace', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * ¿Este rol puede abrir esta sección? Falla cerrado mientras el rol no
 * esté resuelto, igual que `useCan` y el guard de rutas: preferimos que
 * el rail aparezca corto por un instante a mostrar una sección de
 * administración a quien no le corresponde.
 */
export function canAccessSection(
  section: SettingsSection,
  role: AccountRole | null | undefined,
): boolean {
  if (!SECTION_META[section].adminOnly) return true;
  return !!role && hasMinRole(role, 'admin');
}

/**
 * Sección de arranque del rol. Un admin sigue cayendo en el Overview;
 * quien no llega a admin abre directamente su perfil, que es lo primero
 * de las secciones que sí puede ver.
 */
export function defaultSectionForRole(
  role: AccountRole | null | undefined,
): SettingsSection {
  return canAccessSection(DEFAULT_SECTION, role) ? DEFAULT_SECTION : 'profile';
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 *
 * El rol entra en la resolución porque el `?tab=` es un enlace que
 * circula: el menú de la cuenta apuntaba fijo a `?tab=whatsapp`, y un
 * enlace reenviado por un compañero puede traer cualquier sección. Si la
 * sección pedida no le corresponde al rol, cae en su sección de arranque
 * en vez de renderizar un panel de administración.
 */
export function resolveSection(
  raw: string | null,
  role?: AccountRole | null,
): SettingsSection {
  const requested =
    raw === 'tags' || raw === 'custom-fields'
      ? 'fields'
      : isSection(raw)
        ? raw
        : DEFAULT_SECTION;

  return canAccessSection(requested, role) ? requested : defaultSectionForRole(role);
}
