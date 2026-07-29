// Roblox GUI property -> CSS. The mapping is exact where Roblox and CSS agree
// (UDim2 is literally percent + pixels, AnchorPoint is a translate), and a
// disclosed approximation where they do not (TextScaled, font families).

import type { CSSProperties } from 'react'
import type { RbxInstance, RbxPropValue } from '@/lib/rbx/types'

export const GUI_OBJECT_CLASSES = new Set([
  'Frame',
  'ScrollingFrame',
  'CanvasGroup',
  'TextLabel',
  'TextButton',
  'TextBox',
  'ImageLabel',
  'ImageButton',
  'ViewportFrame',
  'VideoFrame',
])

export const TEXT_CLASSES = new Set(['TextLabel', 'TextButton', 'TextBox'])
export const IMAGE_CLASSES = new Set(['ImageLabel', 'ImageButton'])

/**
 * Roblox ships its own typefaces; the browser does not have them. Each family
 * maps to the closest common web stack — a preview, not a pixel match.
 */
const FONT_STACKS: Record<string, string> = {
  BuilderSans: 'Inter, "Segoe UI", system-ui, sans-serif',
  BuilderExtended: 'Inter, "Segoe UI", system-ui, sans-serif',
  BuilderMono: 'ui-monospace, "SF Mono", Menlo, monospace',
  SourceSansPro: '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif',
  LegacyArial: 'Arial, Helvetica, sans-serif',
  Arimo: 'Arial, Helvetica, sans-serif',
  Roboto: 'Roboto, system-ui, sans-serif',
  RobotoCondensed: '"Roboto Condensed", "Arial Narrow", sans-serif',
  RobotoMono: 'ui-monospace, "Roboto Mono", monospace',
  Inconsolata: 'ui-monospace, Inconsolata, monospace',
  PressStart2P: '"Press Start 2P", ui-monospace, monospace',
  Merriweather: 'Merriweather, Georgia, serif',
  RomanAntique: 'Georgia, "Times New Roman", serif',
  AccanthisADFStd: 'Georgia, "Times New Roman", serif',
  Balthazar: 'Georgia, "Times New Roman", serif',
  Montserrat: 'Montserrat, system-ui, sans-serif',
  Nunito: 'Nunito, system-ui, sans-serif',
  Oswald: 'Oswald, "Arial Narrow", sans-serif',
  TitilliumWeb: '"Titillium Web", system-ui, sans-serif',
  Ubuntu: 'Ubuntu, system-ui, sans-serif',
  JosefinSans: '"Josefin Sans", system-ui, sans-serif',
  Jura: 'Jura, system-ui, sans-serif',
  Sarpanch: 'Sarpanch, system-ui, sans-serif',
  Michroma: 'Michroma, system-ui, sans-serif',
  Zekton: '"Zekton", system-ui, sans-serif',
  Guru: 'system-ui, sans-serif',
  HighwayGothic: '"Arial Narrow", system-ui, sans-serif',
  ComicNeueAngular: '"Comic Neue", "Comic Sans MS", cursive',
  IndieFlower: '"Indie Flower", "Comic Sans MS", cursive',
  Kalam: 'Kalam, "Comic Sans MS", cursive',
  PatrickHand: '"Patrick Hand", "Comic Sans MS", cursive',
  PermanentMarker: '"Permanent Marker", "Comic Sans MS", cursive',
  AmaticSC: '"Amatic SC", cursive',
  Bangers: 'Bangers, "Comic Sans MS", cursive',
  Creepster: 'Creepster, fantasy',
  DenkOne: '"Denk One", system-ui, sans-serif',
  Fondamento: 'Fondamento, cursive',
  FredokaOne: '"Fredoka One", system-ui, sans-serif',
  GrenzeGotisch: '"Grenze Gotisch", fantasy',
  LuckiestGuy: '"Luckiest Guy", fantasy',
  SpecialElite: '"Special Elite", ui-monospace, monospace',
}

const WEIGHTS: Record<string, number> = {
  Thin: 100,
  ExtraLight: 200,
  Light: 300,
  Regular: 400,
  Medium: 500,
  SemiBold: 600,
  Bold: 700,
  ExtraBold: 800,
  Heavy: 900,
}

export function familyName(family: string): string {
  const match = /families\/([A-Za-z0-9_]+)\.json$/.exec(family)
  return match ? match[1] : family
}

export function fontStack(family: string): string {
  return FONT_STACKS[familyName(family)] ?? 'Inter, system-ui, sans-serif'
}

export function fontWeight(weight: string): number {
  return WEIGHTS[weight] ?? 400
}

// --- typed property readers -------------------------------------------------

export function prop(inst: RbxInstance, name: string): RbxPropValue | undefined {
  return inst.props[name]
}

export function udim2(value: RbxPropValue | undefined): [[number, number], [number, number]] | null {
  return value?.type === 'UDim2' ? value.value : null
}

export function udim(value: RbxPropValue | undefined): [number, number] | null {
  return value?.type === 'UDim' ? value.value : null
}

export function vector2(value: RbxPropValue | undefined): [number, number] | null {
  return value?.type === 'Vector2' ? value.value : null
}

export function color(value: RbxPropValue | undefined): string | null {
  if (value?.type !== 'Color3') return null
  const [r, g, b] = value.value
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`
}

export function number(value: RbxPropValue | undefined): number | null {
  if (value === undefined) return null
  switch (value.type) {
    case 'float':
    case 'double':
    case 'int':
    case 'int64':
      return value.value
    default:
      return null
  }
}

export function bool(value: RbxPropValue | undefined): boolean | null {
  return value?.type === 'bool' ? value.value : null
}

export function text(value: RbxPropValue | undefined): string | null {
  return value?.type === 'string' ? value.value : null
}

export function tokenName(value: RbxPropValue | undefined): string | null {
  return value?.type === 'token' ? value.itemName ?? null : null
}

/** `calc(<scale>% + <offset>px)`, collapsed when one side is zero. */
export function udimCss([scale, offset]: [number, number]): string {
  if (scale === 0) return `${offset}px`
  if (offset === 0) return `${scale * 100}%`
  return `calc(${scale * 100}% ${offset < 0 ? '-' : '+'} ${Math.abs(offset)}px)`
}

function alphaColor(value: RbxPropValue | undefined, transparency: number | null): string | null {
  if (value?.type !== 'Color3') return null
  const [r, g, b] = value.value
  const alpha = 1 - (transparency ?? 0)
  if (alpha <= 0) return null
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)} / ${alpha})`
}

/** Layout + paint for one GuiObject, before its modifier children are folded in. */
export function guiObjectStyle(inst: RbxInstance, laidOut: boolean): CSSProperties {
  const size = udim2(prop(inst, 'Size')) ?? [
    [0, 100],
    [0, 100],
  ]
  const position = udim2(prop(inst, 'Position')) ?? [
    [0, 0],
    [0, 0],
  ]
  const anchor = vector2(prop(inst, 'AnchorPoint')) ?? [0, 0]
  const rotation = number(prop(inst, 'Rotation')) ?? 0

  const transforms: string[] = []
  if (anchor[0] !== 0 || anchor[1] !== 0) {
    transforms.push(`translate(${-anchor[0] * 100}%, ${-anchor[1] * 100}%)`)
  }
  if (rotation !== 0) transforms.push(`rotate(${rotation}deg)`)

  const style: CSSProperties = {
    position: laidOut ? 'relative' : 'absolute',
    boxSizing: 'border-box',
    width: udimCss(size[0]),
    height: udimCss(size[1]),
    overflow: bool(prop(inst, 'ClipsDescendants')) ? 'hidden' : 'visible',
  }
  if (!laidOut) {
    style.left = udimCss(position[0])
    style.top = udimCss(position[1])
  }
  if (transforms.length > 0) style.transform = transforms.join(' ')

  const background = alphaColor(prop(inst, 'BackgroundColor3'), number(prop(inst, 'BackgroundTransparency')))
  // Roblox's own default is white; an unset BackgroundColor3 on a visible frame
  // still paints, so mirror that rather than rendering nothing.
  if (background) style.background = background
  else if ((number(prop(inst, 'BackgroundTransparency')) ?? 0) < 1) style.background = 'rgb(255 255 255)'

  const borderPixels = number(prop(inst, 'BorderSizePixel'))
  const borderColor = color(prop(inst, 'BorderColor3'))
  if (borderPixels && borderPixels > 0) {
    style.border = `${borderPixels}px solid ${borderColor ?? 'rgb(27 42 53)'}`
  }

  const zIndex = number(prop(inst, 'ZIndex'))
  if (zIndex !== null) style.zIndex = zIndex

  return style
}

/** Text paint for a TextLabel / TextButton / TextBox. */
/** Roblox shrinks or grows the text to fill the box on both axes. */
export function isTextScaled(inst: RbxInstance): boolean {
  return bool(prop(inst, 'TextScaled')) === true
}

/**
 * Solve a TextScaled font size from the measured box: the glyph box is about
 * 1.2x the font size tall, and an average glyph advance is about 0.58em wide.
 */
export function scaledFontSize(width: number, height: number, chars: number): number {
  const byHeight = height / 1.25
  const byWidth = chars > 0 ? width / (0.58 * chars) : byHeight
  return Math.max(1, Math.min(byHeight, byWidth))
}

export function textStyle(inst: RbxInstance): CSSProperties {
  const style: CSSProperties = {
    display: 'flex',
    lineHeight: 1.1,
    whiteSpace: bool(prop(inst, 'TextWrapped')) ? 'pre-wrap' : 'pre',
    overflow: 'hidden',
  }

  const xAlign = tokenName(prop(inst, 'TextXAlignment')) ?? 'Center'
  const yAlign = tokenName(prop(inst, 'TextYAlignment')) ?? 'Center'
  style.justifyContent = xAlign === 'Left' ? 'flex-start' : xAlign === 'Right' ? 'flex-end' : 'center'
  style.alignItems = yAlign === 'Top' ? 'flex-start' : yAlign === 'Bottom' ? 'flex-end' : 'center'
  style.textAlign = xAlign === 'Left' ? 'left' : xAlign === 'Right' ? 'right' : 'center'

  const textColor = alphaColor(prop(inst, 'TextColor3'), number(prop(inst, 'TextTransparency')))
  style.color = textColor ?? 'rgb(0 0 0)'

  const font = prop(inst, 'FontFace')
  if (font?.type === 'Font') {
    style.fontFamily = fontStack(font.value.family)
    style.fontWeight = fontWeight(font.value.weight)
    if (font.value.style === 'Italic') style.fontStyle = 'italic'
  } else {
    style.fontFamily = fontStack('SourceSansPro')
  }

  // TextScaled has no CSS equivalent. The box is measured in the DOM and the
  // font size is solved from it (see useScaledFont); untouched here so the
  // measured value wins. Disclosed as an approximation in the viewer notes.
  if (!isTextScaled(inst)) {
    style.fontSize = `${number(prop(inst, 'TextSize')) ?? 14}px`
  }

  const stroke = number(prop(inst, 'TextStrokeTransparency'))
  const strokeColor = color(prop(inst, 'TextStrokeColor3'))
  if (stroke !== null && stroke < 1) {
    const c = strokeColor ?? 'rgb(0 0 0)'
    style.textShadow = `-1px 0 ${c}, 1px 0 ${c}, 0 -1px ${c}, 0 1px ${c}`
  }

  return style
}

export interface Modifiers {
  style: CSSProperties
  /** UIPadding insets children and text, so it is applied to both boxes. */
  padding: CSSProperties
  /** Set when a UIListLayout/UIGridLayout owns the children's positions. */
  layout: CSSProperties | null
}

/** Folds UICorner / UIPadding / UIStroke / UIGradient / UIListLayout children in. */
export function modifierStyles(inst: RbxInstance): Modifiers {
  const style: CSSProperties = {}
  const padding: CSSProperties = {}
  let layout: CSSProperties | null = null

  for (const child of inst.children) {
    switch (child.className) {
      case 'UICorner': {
        const radius = udim(prop(child, 'CornerRadius')) ?? [0, 8]
        style.borderRadius = udimCss(radius)
        break
      }
      case 'UIPadding': {
        const top = udim(prop(child, 'PaddingTop'))
        const bottom = udim(prop(child, 'PaddingBottom'))
        const left = udim(prop(child, 'PaddingLeft'))
        const right = udim(prop(child, 'PaddingRight'))
        if (top) padding.paddingTop = udimCss(top)
        if (bottom) padding.paddingBottom = udimCss(bottom)
        if (left) padding.paddingLeft = udimCss(left)
        if (right) padding.paddingRight = udimCss(right)
        break
      }
      case 'UIStroke': {
        const thickness = number(prop(child, 'Thickness')) ?? 1
        const strokeColor = alphaColor(prop(child, 'Color'), number(prop(child, 'Transparency'))) ?? 'rgb(0 0 0)'
        style.outline = `${thickness}px solid ${strokeColor}`
        style.outlineOffset = '0px'
        break
      }
      case 'UIGradient': {
        const value = prop(child, 'Color')
        if (value?.type === 'ColorSequence') {
          const rotation = number(prop(child, 'Rotation')) ?? 0
          const stops = value.value
            .map((k) => `rgb(${k.color.map((c) => Math.round(c * 255)).join(' ')}) ${k.time * 100}%`)
            .join(', ')
          style.background = `linear-gradient(${rotation + 90}deg, ${stops})`
        }
        break
      }
      case 'UIListLayout': {
        const direction = tokenName(prop(child, 'FillDirection')) ?? 'Vertical'
        const padding = udim(prop(child, 'Padding'))
        const horizontal = tokenName(prop(child, 'HorizontalAlignment')) ?? 'Left'
        const vertical = tokenName(prop(child, 'VerticalAlignment')) ?? 'Top'
        const main = direction === 'Horizontal' ? horizontal : vertical
        const cross = direction === 'Horizontal' ? vertical : horizontal
        const toFlex = (value: string): string =>
          value === 'Center' ? 'center' : value === 'Right' || value === 'Bottom' ? 'flex-end' : 'flex-start'
        layout = {
          display: 'flex',
          flexDirection: direction === 'Horizontal' ? 'row' : 'column',
          gap: padding ? udimCss(padding) : undefined,
          justifyContent: toFlex(main),
          alignItems: toFlex(cross),
        }
        break
      }
      default:
        break
    }
  }

  return { style, padding, layout }
}
