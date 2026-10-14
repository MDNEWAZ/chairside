# Design rules

## Source of truth
- design/tokens.json (mirrored as the @theme block in web/src/styles.css) is the only source for color, type, spacing, radius, and shadow values. Never write a raw hex color, pixel size, or font name in a component.
- The hero screens in design/hero-screens/ are the visual reference. Before building any screen, find the closest hero screen and copy its layout, spacing, and component use.
- If a component or pattern you need does not exist, stop and ask. Do not invent one.

## Anti-generic rules
- Never ship a component library's default theme. Every component is restyled with the tokens.
- No gradients, glassmorphism, glows, stacked drop shadows, decorative shapes, or stock illustrations.
- No emoji as icons. Use one icon set, one stroke weight, one size scale.
- No marketing-style layouts: no centered hero sections, oversized headings, or grids of equal cards where a table or list fits the data better.
- Use one accent color only. It marks primary actions and the current selection, and nothing else.
- Use the three signature elements (shift card, status badge, page header) exactly as designed. Never restyle them per screen.
- Do not add decoration to fill space. Empty space is fine.

## Consistency
- Spacing comes only from the scale: 4, 8, 12, 16, 24, 32, 48. Page padding and the gaps between sections use the same values on every screen.
- Type comes only from the token scale: page title, section title, body, small, label. Headings never skip levels.
- Radius has three values: controls, cards, badges. No others.
- Prefer 1px borders or background tints to separate areas. Shadows are only for menus, popovers, and dialogs.
- Every list of records uses the same table component: same row height, header style, sorting, and empty state.
- Every form uses the same layout: label above the field, helper text below, error text below in the error color, primary button at the bottom right on desktop and full width on phones.
- One primary button per area of a screen. Destructive actions use the destructive style and ask for confirmation.
- Status always uses the badge component with text and color, never color alone: pending, approved, rejected, flagged, expiring, expired, active, deactivated.
- Dates and times use one format everywhere, in the clinic's time zone, for example Mon, Oct 12 and 9:00 AM.
- People are shown as First Last. Roles and locations use the exact names from the content list.

## States
- Every screen and every data component has loading, empty, error, and no-permission states.
- Loading uses skeletons that match the final layout. Empty states say what the screen is for and offer the next action. Errors say what happened and how to fix it.
- The shift conflict, minimum staffing, overtime, and missing clock-out warnings use the warning pattern from the hero screens, and the expired-licence block uses a blocking variant of it. Never invent a new alert style.

## Roles and data
- Hide what a role cannot use. Do not show disabled buttons for actions a role never has.
- Pay data appears only in the pay section of a profile for owner_admin, and in each person's own pay view.
- Always show the location on shifts and on any list that spans both locations.

## Phone and desktop
- Staff screens (my schedule, clock in and out, leave request, notifications) are designed for a 360px phone first, then widened.
- Manager screens (weekly schedule, staff directory, reports) are designed for desktop first and must work on a tablet. On a phone they switch to a day view or a list instead of a squeezed grid.
- Tap targets are at least 44 by 44 px. The clock in and out button is the largest control on its screen.
- The page never scrolls sideways. Wide tables scroll inside their own container.

## Accessibility
- Text contrast is at least 4.5 to 1, and interface elements at least 3 to 1.
- Everything works with the keyboard, with a visible focus ring from the tokens.
- Every input has a visible label. Icon-only buttons have an accessible name.
- Never rely on color alone for meaning.
- Motion is only for feedback, 150 to 200 ms, and respects the reduced motion setting.

## Content
- Use the wording in design/content-list.md. Buttons start with a verb, such as Request leave. Use sentence case everywhere.
- Keep the tone plain and calm: no exclamation marks, no jokes.
- Error messages never blame the user and always say what to do next.

## Check your work
- After building a screen, name the hero screen it copies and any new pattern it introduces.
- Check every screen at 360, 768, and 1280 px wide before calling it done.
- Before finishing a task, review the screen against these rules and list any rule you could not follow.
- Do not change the styling of screens that are not part of the task.
