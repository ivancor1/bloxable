'use client'

// Screen UI preview. Roblox's 2D GUI is a percent + pixel box model, which is
// exactly CSS, so the overlay draws the real elements as real DOM on top of the
// 3D canvas instead of faking them in the scene. Every ScreenGui in StarterGui
// is drawn the way a player would see it, because StarterGui is what Roblox
// copies into each player's PlayerGui on spawn.

import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/lib/state/store'
import type { RbxInstance, RbxTree } from '@/lib/rbx/types'
import {
  GUI_OBJECT_CLASSES,
  IMAGE_CLASSES,
  TEXT_CLASSES,
  bool,
  guiObjectStyle,
  isTextScaled,
  modifierStyles,
  scaledFontSize,
  prop,
  text,
  textStyle,
} from './guiStyle'

function screenGuis(tree: RbxTree | null): RbxInstance[] {
  const starterGui = tree?.services.find((s) => s.className === 'StarterGui')
  if (!starterGui) return []
  return starterGui.children.filter(
    (child) => child.className === 'ScreenGui' && bool(prop(child, 'Enabled')) !== false,
  )
}

/**
 * TextScaled needs the element's real pixel box, which only exists after
 * layout, so the box is measured and the font size solved from it.
 */
function useScaledFont(enabled: boolean, chars: number) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<number | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!enabled || !node) {
      setSize(null)
      return
    }
    const measure = () => {
      const rect = node.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setSize(scaledFontSize(rect.width, rect.height, chars))
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, chars])

  return [ref, size] as const
}

function GuiElement({
  inst,
  laidOut,
  selectionId,
  onSelect,
}: {
  inst: RbxInstance
  laidOut: boolean
  selectionId: string | null
  onSelect: (id: string) => void
}): ReactNode {
  const isText = TEXT_CLASSES.has(inst.className)
  const isImage = IMAGE_CLASSES.has(inst.className)
  const label = isText ? text(prop(inst, 'Text')) ?? '' : ''
  const [fontRef, fontSize] = useScaledFont(isText && isTextScaled(inst), label.length)

  if (bool(prop(inst, 'Visible')) === false) return null

  const modifiers = modifierStyles(inst)

  const style: CSSProperties = {
    ...guiObjectStyle(inst, laidOut),
    ...(isText ? textStyle(inst) : {}),
    ...modifiers.style,
    ...modifiers.padding,
  }
  if (fontSize !== null) style.fontSize = `${fontSize}px`
  if (inst.id === selectionId) {
    style.outline = '2px solid #4ea1ff'
    style.outlineOffset = '1px'
  }

  const children = inst.children.filter((child) => GUI_OBJECT_CLASSES.has(child.className))

  // An element cannot be a flex container for its children and a flex box for
  // its own text at the same time, so laid-out children go in a wrapper.
  const rendered =
    children.length > 0 ? (
      <div
        style={{
          position: 'absolute',
          inset: 0,
          boxSizing: 'border-box',
          ...modifiers.padding,
          ...(modifiers.layout ?? {}),
        }}
      >
        {children.map((child) => (
          <GuiElement
            key={child.id}
            inst={child}
            laidOut={modifiers.layout !== null}
            selectionId={selectionId}
            onSelect={onSelect}
          />
        ))}
      </div>
    ) : null

  return (
    <div
      ref={fontRef}
      style={style}
      title={`${inst.name} (${inst.className})`}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(inst.id)
      }}
    >
      {isText ? label : null}
      {isImage ? <ImagePlaceholder inst={inst} /> : null}
      {rendered}
    </div>
  )
}

/**
 * Roblox image assets live behind rbxassetid:// and cannot be fetched from a
 * browser, so the preview shows the slot honestly rather than pretending.
 */
function ImagePlaceholder({ inst }: { inst: RbxInstance }) {
  const id = text(prop(inst, 'Image')) ?? ''
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px dashed rgb(255 255 255 / 0.45)',
        color: 'rgb(255 255 255 / 0.6)',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 10,
        overflow: 'hidden',
      }}
    >
      {id ? 'image' : 'no image'}
    </div>
  )
}

export default function GuiOverlay() {
  const tree = useAppStore((state) => state.tree)
  const selectionId = useAppStore((state) => state.selectionId)
  const select = useAppStore((state) => state.select)

  const guis = screenGuis(tree)
  if (guis.length === 0) return null

  return (
    <div
      data-testid="gui-overlay"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {guis.map((gui) => (
        <div key={gui.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
          {gui.children
            .filter((child) => GUI_OBJECT_CLASSES.has(child.className))
            .map((child) => (
              <GuiElement
                key={child.id}
                inst={child}
                laidOut={false}
                selectionId={selectionId}
                onSelect={select}
              />
            ))}
        </div>
      ))}
    </div>
  )
}
