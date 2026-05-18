# WiFiKit Design Guidelines

Source: MasterGo `🎨【App】WiFiKit设计稿`

- File ID: `110100602671696`
- Current self-test module page: `5242:26692`
- Device self-test in-progress frame: `5242:31941`
- Design spec page discovered in MasterGo: `0:5051`

## Visual Direction

WiFiKit uses a clean mobile utility style: white app surfaces, compact information density, blue primary actions, soft gray panels, and small status indicators. Screens are designed for repeated operational use rather than marketing presentation.

## Canvas And Device

- Main mobile frame: `iPhone 13 mini`
- Screen size: `375 x 812`
- Background: `tertiary/gray-8` / `#FFFFFF`
- Standard status bar height: `44`
- Standard title bar height: `44`
- Home indicator area height: `34`
- Main content commonly starts below navigation at around `y=110`
- Layout grid exists at `1px`

## Color Tokens

- `primary/default`: `#3B7AFF`
- `primary/pressed`: `#1C74E9`
- `tertiary/gray-1`: `#161E28`
- `tertiary/gray-2`: `#5A6482`
- `tertiary/gray-3`: `#8690A9`
- `tertiary/gray-6`: `#E8ECF1`
- `tertiary/gray-7`: `#F6F8FC`
- `tertiary/gray-8`: `#FFFFFF`
- `auxiliary/red`: `#FB4D4D`
- success green used in self-test status: `#56CF34`
- warning yellow used in status palette: `#FFB735`

## Typography

- Chinese app UI uses `Source Han Sans`.
- English UI uses `SF Pro Text`.
- Spec documentation uses `OPPOSans`.
- Title bar text: `Source Han Sans`, `16px`, bold, `24px` line height.
- English secondary title token: `SF Pro Text`, `14px`, semibold, `20px` line height.
- English secondary body token: `SF Pro Text`, `14px`, regular, `20px` line height.
- Status bar time: `14px`, semibold/bold feel.

## Components And Spacing

- Use 375px mobile frames and preserve native status bar/title bar rhythm.
- Main illustration card in self-test: `311 x 180`, radius `8px`, fill `tertiary/gray-7`.
- Self-test content block width: `311px`, centered with `32px` side margins.
- Self-test detail rows use 20px text line height and 16px status icons.
- Common vertical rhythm in self-test details: `16px` gaps between grouped content.
- Success/fail/loading status icons are `16 x 16`.
- Use thin `1px` dividers/strokes from `tertiary/gray-6`.

## Self-Test Pattern

Self-test screens should preserve this hierarchy:

1. Status bar
2. Title/navigation bar
3. Large diagnostic illustration
4. Compact status summary section
5. Row-based diagnostic results
6. Bottom home indicator or fixed bottom action, depending on flow

Status semantics:

- Success: green circular check, `#56CF34`
- Fail: red circular mark, `auxiliary/red`
- Loading: 16px circular loading icon
- Unknown/waiting: neutral gray text or placeholder such as `--`

## Implementation Notes

- Prefer project tokens in comments or variable names when coding colors.
- Avoid one-off colors unless the MasterGo node uses a non-token color.
- Keep utility screens compact and scannable.
- Use real component states rather than static screenshots.
