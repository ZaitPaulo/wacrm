"use client";

import { Check, Globe, Moon, Palette, SunMoon, Sun } from "lucide-react";

import { useLocale } from "@/hooks/use-locale";
import { useTheme } from "@/hooks/use-theme";
import type { Dictionary } from "@/lib/dictionaries/es";
import { LOCALE_META, interpolate, type Locale } from "@/lib/i18n";
import { MODES, THEMES, type Mode, type ThemeId } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { SettingsPanelHead } from "./settings-panel-head";

/**
 * Appearance panel — light/dark mode, accent-color picker, and the
 * interface language.
 *
 * Three independent controls. Each applies + persists immediately;
 * there is no save button, because every change is a single swap on
 * <html> with nothing to roll back.
 *
 * Language lives here rather than in the header because it is a
 * preference of the same kind as the other two, and because this is
 * where users already come looking for how the app presents itself.
 *
 * Persistence is device-scoped for all three, which is what the panel
 * description promises — theme and mode via localStorage (replayed by
 * the boot script in layout.tsx), language via a cookie the server
 * reads while rendering.
 */
export function AppearancePanel() {
  const { theme, setTheme, mode, setMode } = useTheme();
  const { t, locale, setLocale } = useLocale();
  return (
    <section className="max-w-3xl animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title={t.settings.appearance.title}
        description={t.settings.appearance.description}
      />

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <SunMoon className="size-4 text-muted-foreground" />
          {t.settings.appearance.mode}
        </h3>

        <div
          role="radiogroup"
          aria-label={t.settings.appearance.colorMode}
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {MODES.map((m) => (
            <ModeCard
              key={m}
              mode={m}
              isActive={m === mode}
              onPick={() => setMode(m)}
              t={t}
            />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Globe className="size-4 text-muted-foreground" />
          {t.settings.appearance.language}
        </h3>

        <div
          role="radiogroup"
          aria-label={t.settings.appearance.languageGroup}
          className="grid max-w-md grid-cols-2 gap-3"
        >
          {LOCALE_META.map((l) => (
            <LanguageCard
              key={l.id}
              id={l.id}
              name={l.name}
              englishName={l.englishName}
              isActive={l.id === locale}
              onPick={() => setLocale(l.id)}
              t={t}
            />
          ))}
        </div>
      </div>

      <div className="mt-8 space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Palette className="size-4 text-muted-foreground" />
          {t.settings.appearance.accentColor}
        </h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {THEMES.map((theme_) => (
            <ThemeCard
              key={theme_.id}
              id={theme_.id}
              swatch={theme_.swatch}
              isActive={theme_.id === theme}
              onPick={() => setTheme(theme_.id)}
              t={t}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function LanguageCard({
  id,
  name,
  englishName,
  isActive,
  onPick,
  t,
}: {
  id: Locale;
  name: string;
  englishName: string;
  isActive: boolean;
  onPick: () => void;
  t: Dictionary;
}) {
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={interpolate(t.settings.appearance.useLanguage, { name })}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold uppercase text-foreground"
      >
        {id}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">
          {name}
        </span>
        {/* The English name as a subtitle, so the option stays findable
            for someone who landed in a language they don't read. */}
        {englishName !== name && (
          <span className="block truncate text-xs text-muted-foreground">
            {englishName}
          </span>
        )}
      </span>
      {isActive && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="h-3 w-3" />
          {t.common.active}
        </span>
      )}
    </button>
  );
}

function ModeCard({
  mode,
  isActive,
  onPick,
  t,
}: {
  mode: Mode;
  isActive: boolean;
  onPick: () => void;
  t: Dictionary;
}) {
  const isLight = mode === "light";
  const Icon = isLight ? Sun : Moon;
  // The visible name comes from the dictionary rather than the raw
  // `mode` id, which also drops the `capitalize` class the English
  // lowercase ids needed.
  const label = isLight
    ? t.settings.appearance.light
    : t.settings.appearance.dark;
  return (
    <button
      type="button"
      role="radio"
      onClick={onPick}
      aria-checked={isActive}
      aria-label={interpolate(t.settings.appearance.useMode, { mode: label })}
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground"
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 text-sm font-semibold text-foreground">
        {label}
      </span>
      {isActive && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
          <Check className="h-3 w-3" />
          {t.common.active}
        </span>
      )}
    </button>
  );
}

function ThemeCard({
  id,
  swatch,
  isActive,
  onPick,
  t,
}: {
  id: ThemeId;
  swatch: string;
  isActive: boolean;
  onPick: () => void;
  t: Dictionary;
}) {
  // Name and tagline moved out of `lib/themes.ts` and into the
  // dictionary: they are prose, and this panel is the one place they
  // are read. The catalog keeps what is genuinely presentational —
  // the id, the swatch, and the picker order.
  const { name, tagline } = t.settings.appearance.themes[id];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={isActive}
      aria-label={interpolate(t.settings.appearance.useTheme, { name })}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors",
        isActive
          ? "border-primary/60 ring-2 ring-primary/40"
          : "border-border hover:border-border hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          aria-hidden
          className="h-8 w-8 shrink-0 rounded-full"
          style={{
            background: swatch,
            boxShadow: "inset 0 0 0 1px oklch(1 0 0 / 0.15)",
          }}
        />
        {isActive && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            <Check className="h-3 w-3" />
            {t.common.active}
          </span>
        )}
      </div>
      <div>
        <div className="text-sm font-semibold text-foreground">{name}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {tagline}
        </div>
      </div>
      <div
        className="mt-1 flex h-2 overflow-hidden rounded-full"
        aria-hidden
      >
        <span className="flex-1" style={{ background: swatch }} />
        <span className="w-3 bg-muted-foreground/60" />
        <span className="w-3 bg-muted" />
        <span className="w-3 bg-card" />
      </div>
      <span className="sr-only">
        {interpolate(t.settings.appearance.themeId, { id })}
      </span>
    </button>
  );
}
