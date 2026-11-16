# Sightline UI

Sightline follows [tauri-ui](https://github.com/agmmnn/tauri-ui): upstream shadcn/ui components, Radix accessibility, and desktop-ready behavior. The existing Tauri backend is retained. Do not reintroduce HeroUI or separate extension themes.

## Foundation

`src/theme.css` defines the semantic shadcn tokens. Both app and extension import it, the locally bundled Inter Variable font, and the same component source from `src/components/ui`. Orange #F26628 remains the primary accent. Light is the default, with an explicit persistent dark-mode switch. Never give a custom component an independent palette or control style.

Use upstream Button variants, Input, Textarea, Field, Dialog, Popover, DropdownMenu, ToggleGroup, Tabs, Tooltip, Separator and Empty. Custom research components inherit their radius, border, spacing, focus and state conventions. Use Lucide icons and respect reduced motion.

## Desktop

A global command bar spans the window. An 88px graphite navigation rail separates Library, Discover, Canvas, Favorites, Fonts and Trash. Collections are horizontal tabs within Library. The page title, description and primary action introduce each workspace; search, filter popovers, grouping and density controls sit above the references. Cards have a contained visual preview and a readable source footer. List mode is a horizontal version of the same card. Fonts are specimen sheets. Canvas nodes use semantic theme tokens.

The media workspace has a large neutral stage, thumbnail strip and a tabbed inspector: Details, Assets and Notes. Specialized crop and annotation geometry may be custom; its controls use the same design system. Source and Discover forms use Radix dialogs, shared fields, validation and focus restoration.

## Chrome extension

The popup is a compact capture launcher: a primary visible-tab action, then full-page, area and recording rows, font discovery and recording history. Screenshot and recording editors use a common React shell with a canvas stage, tool row, reference inspector and feedback. The recording editor adds its timeline below the stage. Native select controls are used for collections. Existing capture, crop, annotation, storage and export engines mount after the UI, preserving behavior.

`bun run build` builds both app and extension. `bun run build:extension` updates the unpacked extension UI independently. Generated `extension/ui` assets are included with the unpacked extension and should be rebuilt from `extension/ui.tsx`, `extension/ui.css` and `extension/interaction.css`.
