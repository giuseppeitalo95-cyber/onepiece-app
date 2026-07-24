'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_LOCALE,
  getStoredLocale,
  LOCALE_STORAGE_KEY,
  translateUiText,
  type AppLocale,
} from '@/lib/i18n'

type LanguageContextValue = {
  locale: AppLocale
  setLocale: (locale: AppLocale) => void
  t: (value: string) => string
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: DEFAULT_LOCALE,
  setLocale: () => undefined,
  t: value => value,
})

const textOriginals = new WeakMap<Text, string>()
const attributeOriginals = new WeakMap<Element, Map<string, string>>()
const textRenderedValues = new WeakMap<Text, string>()
const attributeRenderedValues = new WeakMap<Element, Map<string, string>>()
const TRANSLATED_ATTRIBUTES = ['placeholder', 'aria-label', 'title']
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE'])

const shouldSkip = (element: Element | null) =>
  !element
  || SKIPPED_TAGS.has(element.tagName)
  || Boolean(element.closest('[data-i18n-ignore="true"], .notranslate'))

const translateTextNode = (node: Text, locale: AppLocale) => {
  const parent = node.parentElement
  if (shouldSkip(parent)) return

  const current = node.nodeValue || ''
  const lastRendered = textRenderedValues.get(node)

  // A value different from the last one written by the translator came from
  // React (for example Free -> Admin or a new scan status). Treat it as the
  // new source text instead of restoring stale content.
  if (!textOriginals.has(node) || (lastRendered !== undefined && current !== lastRendered)) {
    textOriginals.set(node, current)
  }

  const original = textOriginals.get(node) || current
  const next = translateUiText(original, locale)
  if (current !== next) node.nodeValue = next
  textRenderedValues.set(node, next)
}

const translateAttributes = (element: Element, locale: AppLocale) => {
  if (shouldSkip(element)) return
  let originals = attributeOriginals.get(element)
  let renderedValues = attributeRenderedValues.get(element)
  if (!originals) {
    originals = new Map()
    attributeOriginals.set(element, originals)
  }
  if (!renderedValues) {
    renderedValues = new Map()
    attributeRenderedValues.set(element, renderedValues)
  }

  TRANSLATED_ATTRIBUTES.forEach(attribute => {
    const current = element.getAttribute(attribute)
    if (!current) return
    const lastRendered = renderedValues?.get(attribute)

    if (!originals?.has(attribute) || (lastRendered !== undefined && current !== lastRendered)) {
      originals?.set(attribute, current)
    }

    const original = originals?.get(attribute) || current
    const next = translateUiText(original, locale)
    if (current !== next) element.setAttribute(attribute, next)
    renderedValues?.set(attribute, next)
  })
}

const translateTree = (root: Node, locale: AppLocale) => {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, locale)
    return
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root as Element, locale)

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  )
  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node as Text, locale)
    else translateAttributes(node as Element, locale)
    node = walker.nextNode()
  }
}

export default function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE)

  useEffect(() => {
    setLocaleState(getStoredLocale())
  }, [])

  const setLocale = useCallback((nextLocale: AppLocale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
    setLocaleState(nextLocale)
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale
    let translating = false

    const apply = (root: Node) => {
      if (translating) return
      translating = true
      observer.disconnect()
      translateTree(root, locale)
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: TRANSLATED_ATTRIBUTES,
      })
      translating = false
    }

    const observer = new MutationObserver(mutations => {
      if (translating) return
      const roots = new Set<Node>()
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') roots.add(mutation.target)
        if (mutation.type === 'attributes') roots.add(mutation.target)
        mutation.addedNodes.forEach(node => roots.add(node))
      })
      roots.forEach(apply)
    })

    apply(document.body)
    return () => observer.disconnect()
  }, [locale])

  const value = useMemo<LanguageContextValue>(() => ({
    locale,
    setLocale,
    t: value => translateUiText(value, locale),
  }), [locale, setLocale])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export const useLanguage = () => useContext(LanguageContext)
