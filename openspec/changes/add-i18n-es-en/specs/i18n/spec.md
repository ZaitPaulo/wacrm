## ADDED Requirements

### Requirement: Supported locales and default

The system SHALL support exactly two locales, Spanish (`es`) and English (`en`), and SHALL treat Spanish as the default locale for any request that does not express a valid preference.

#### Scenario: First-time visitor with no stored preference

- **WHEN** a user loads any page and no locale cookie is present on the request
- **THEN** the system resolves the locale to `es` and renders all migrated UI text in Spanish

#### Scenario: Cookie holds an unsupported or malformed value

- **WHEN** a request carries a locale cookie whose value is not exactly `es` or `en` (for example `fr`, an empty string, or arbitrary text)
- **THEN** the system ignores the value, resolves the locale to `es`, and does not throw

#### Scenario: Locale type guard rejects invalid input

- **WHEN** `isLocale()` is called with a value that is not `es` or `en`, including `null` and `undefined`
- **THEN** it returns `false`, and it returns `true` only for `es` and `en`

### Requirement: Locale persistence via cookie

The system SHALL persist the user's locale choice in a cookie readable by both the server and the client, and SHALL treat that cookie as the single source of truth. The system MUST NOT store the locale in a second location that could diverge from the cookie.

#### Scenario: Choice survives a full page reload

- **WHEN** a user selects English and then reloads the page
- **THEN** the request carries the locale cookie, and the page renders in English from the initial server response

#### Scenario: Choice survives a new browser tab

- **WHEN** a user who selected English opens the application in a new tab
- **THEN** that tab renders in English without any further action

#### Scenario: URLs are unchanged by locale

- **WHEN** a user switches between Spanish and English
- **THEN** the current URL path is unchanged, no redirect occurs, and no locale segment is added to the path

### Requirement: Server-rendered language with no flash

The root layout SHALL resolve the locale on the server and render the correct `lang` attribute on the `<html>` element in the initial HTML response, so the first paint is already in the user's language.

#### Scenario: Initial HTML carries the resolved language

- **WHEN** a user with the English cookie requests any page
- **THEN** the server response contains `<html lang="en">` and English text, with no client-side correction after hydration

#### Scenario: No flash of the wrong language

- **WHEN** a user with a non-default locale loads a page
- **THEN** no frame renders in the default locale before the chosen locale is applied

### Requirement: Dictionary lookup with compile-time key safety

The system SHALL resolve UI text through typed dictionaries keyed by namespace. The Spanish dictionary SHALL define the dictionary type, and the English dictionary SHALL be declared as that type so that a missing or extra key is a compile error rather than a runtime defect.

#### Scenario: Translation key resolves for the active locale

- **WHEN** a component calls the translation function with a valid key and the active locale is English
- **THEN** the English string for that key is returned

#### Scenario: Key missing from the English dictionary fails the build

- **WHEN** a key exists in the Spanish dictionary but is absent from the English dictionary
- **THEN** `npm run typecheck` fails and reports the missing key

#### Scenario: Key not present in the Spanish dictionary fails the build

- **WHEN** a component references a translation key that does not exist in the Spanish dictionary
- **THEN** `npm run typecheck` fails at that call site

### Requirement: Interpolation of dynamic values

The system SHALL substitute named placeholders in translated strings with caller-supplied values, in both locales.

#### Scenario: Named placeholder is substituted

- **WHEN** a string containing a named placeholder is resolved with a value supplied for that name
- **THEN** the returned string contains the value in place of the placeholder

#### Scenario: Placeholder with no supplied value

- **WHEN** a string contains a placeholder for which the caller supplies no value
- **THEN** the function returns the string with that placeholder left untouched and does not throw

#### Scenario: Repeated placeholder

- **WHEN** the same placeholder name appears more than once in a string
- **THEN** every occurrence is replaced with the supplied value

### Requirement: Pluralization

The system SHALL select between a singular and a plural form based on a count, for both Spanish and English, which share the same two-form cardinality.

#### Scenario: Count of one selects the singular form

- **WHEN** the plural helper is called with a count of 1
- **THEN** the singular form is returned

#### Scenario: Counts other than one select the plural form

- **WHEN** the plural helper is called with a count of 0, 2, or any value other than 1
- **THEN** the plural form is returned

#### Scenario: Count is available for interpolation

- **WHEN** the selected form contains a placeholder for the count
- **THEN** the placeholder is replaced with the count value

### Requirement: Locale-aware formatting of dates, times and numbers

Migrated surfaces SHALL format dates, times, relative times and numbers using the platform `Intl` APIs driven by the active locale, rather than fixed-locale or hardcoded English output.

#### Scenario: Dates follow the active locale

- **WHEN** the same timestamp is rendered under Spanish and under English on a migrated surface
- **THEN** each renders in that locale's conventional date format

#### Scenario: Relative times are translated

- **WHEN** a relative timestamp is rendered under Spanish on a migrated surface
- **THEN** it reads in Spanish (for example "hace 2 horas") rather than English

#### Scenario: Numbers follow the active locale

- **WHEN** a numeric value is rendered under Spanish and under English on a migrated surface
- **THEN** each uses that locale's grouping and decimal separators

### Requirement: Language selector

The application SHALL provide a language selector in the appearance settings panel, presented alongside the existing theme and mode controls, that applies the change immediately without a save step or page reload.

#### Scenario: Switching language updates the UI immediately

- **WHEN** a user selects the other language in the appearance panel
- **THEN** all migrated on-screen text re-renders in that language without a page reload

#### Scenario: Selector reflects the active locale

- **WHEN** a user opens the appearance panel
- **THEN** the currently active language is shown as selected

#### Scenario: Selection is persisted on change

- **WHEN** a user selects a language
- **THEN** the locale cookie is written immediately, with no separate save action required

### Requirement: Partial migration does not break unmigrated screens

Screens not yet migrated to the dictionary SHALL continue to render their existing English text unchanged, regardless of the active locale.

#### Scenario: Unmigrated screen under the Spanish locale

- **WHEN** a user with the Spanish locale opens a screen that has not yet been migrated
- **THEN** the screen renders its existing English text, with no blank labels, missing-key placeholders, or errors

### Requirement: WhatsApp template language stays independent

The UI locale SHALL NOT affect the WhatsApp message template `Language` field, which denotes the language registered with Meta for that template.

#### Scenario: Switching UI language leaves template language untouched

- **WHEN** a user switches the UI language while viewing the template manager
- **THEN** the template's Meta `Language` value is unchanged and is not re-submitted to Meta
