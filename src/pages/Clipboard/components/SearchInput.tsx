import { useEventListener } from "ahooks";
import { Input, type InputProps, type InputRef } from "antd";
import type { ChangeEvent, CompositionEvent, FC } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useSnapshot } from "valtio";
import KeyHint from "@/components/KeyHint";
import { prepareClipboardWindowEditableFocus } from "@/hooks/useClipboardWindowEditableFocus";
import { useKeyboardEvent } from "@/hooks/useKeyboardEvent";
import { settingsState } from "@/stores/settings";
import { isMac } from "@/utils/is";

interface SearchInputProps extends Omit<InputProps, "prefix"> {
  blurToken?: number;
  clearToken?: number;
  focusToken?: number;
}

const IGNORED_KEYS = new Set([
  "Escape",
  "Enter",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  "Insert",
  "Delete",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Pause",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
  "F6",
  "F7",
  "F8",
  "F9",
  "F10",
  "F11",
  "F12",
]);

function findEditableElement(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;

  let element: Element | null = target;
  while (element) {
    if (element instanceof HTMLElement) {
      if (element.isContentEditable) return element;

      const tagName = element.tagName.toLowerCase();
      if (tagName === "input" || tagName === "textarea") return element;
    }

    element = element.parentElement;
  }

  return null;
}

function isModalOpen() {
  return Boolean(
    document.querySelector(
      ".ant-modal-open, .ant-modal-wrap:not([style*='display: none'])",
    ),
  );
}

function setInputValueAndDispatch(
  inputEl: HTMLInputElement,
  nextValue: string,
) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(inputEl, nextValue);
  } else {
    inputEl.value = nextValue;
  }

  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
}

function insertTextIntoInput(inputEl: HTMLInputElement, text: string) {
  inputEl.focus();
  let inserted = false;
  try {
    inserted = document.execCommand?.("insertText", false, text) ?? false;
  } catch {}

  if (!inserted) {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    const nextValue =
      inputEl.value.slice(0, start) + text + inputEl.value.slice(end);
    setInputValueAndDispatch(inputEl, nextValue);
    const newCursor = start + text.length;
    inputEl.setSelectionRange(newCursor, newCursor);
  }
}

function deleteBackwardInInput(inputEl: HTMLInputElement) {
  inputEl.focus();
  let deleted = false;
  try {
    deleted = document.execCommand?.("delete") ?? false;
  } catch {}

  if (!deleted) {
    const start = inputEl.selectionStart ?? inputEl.value.length;
    const end = inputEl.selectionEnd ?? inputEl.value.length;
    if (start === end) {
      if (start > 0) {
        const nextValue =
          inputEl.value.slice(0, start - 1) + inputEl.value.slice(end);
        setInputValueAndDispatch(inputEl, nextValue);
        inputEl.setSelectionRange(start - 1, start - 1);
      }
    } else {
      const nextValue =
        inputEl.value.slice(0, start) + inputEl.value.slice(end);
      setInputValueAndDispatch(inputEl, nextValue);
      inputEl.setSelectionRange(start, start);
    }
  }
}

async function pasteIntoInput(inputEl: HTMLInputElement) {
  await prepareClipboardWindowEditableFocus();
  inputEl.focus();
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      insertTextIntoInput(inputEl, text);
      return;
    }
  } catch {}

  try {
    document.execCommand?.("paste");
  } catch {}
}

/**
 * 带快捷键提示的搜索输入框，支持 ⌘F / Ctrl+F 聚焦。
 * IME 拼音/日文组合输入期间抑制 onChange，待 compositionend 再补发一次，
 * 避免上层防抖/受控逻辑被中间态拼字串污染。
 */
const SearchInput: FC<SearchInputProps> = (props) => {
  const {
    blurToken = 0,
    clearToken = 0,
    focusToken = 0,
    onChange,
    onCompositionStart,
    onCompositionEnd,
    ...rest
  } = props;

  const inputRef = useRef<InputRef>(null);
  const composingRef = useRef(false);
  const settings = useSnapshot(settingsState);

  /**
   * 聚焦搜索框并选中已有内容，便于直接覆盖输入。
   */
  const focusSearch = useCallback(async () => {
    if (!inputRef.current) return;

    await prepareClipboardWindowEditableFocus();
    inputRef.current?.focus({ cursor: "all" });
  }, []);

  useEffect(() => {
    if (blurToken <= 0) return;

    inputRef.current?.blur();
  }, [blurToken]);

  useEffect(() => {
    if (focusToken <= 0) return;

    const frame = requestAnimationFrame(() => {
      void focusSearch();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [focusToken, focusSearch]);

  const handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (!settings.clipboard?.search?.defaultFocus) return;
    if (isModalOpen()) return;

    const inputEl = inputRef.current?.input;
    if (!inputEl) return;

    const active = document.activeElement;
    if (active === inputEl) return;
    if (findEditableElement(active)) return;

    const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;

    // Ctrl/Cmd + A: select all text in search box
    if (isModifierPressed && event.key.toLowerCase() === "a") {
      event.preventDefault();
      void prepareClipboardWindowEditableFocus().then(() => {
        inputEl.focus();
        inputEl.select();
      });
      return;
    }

    // Ctrl/Cmd + V: paste directly into search box
    if (isModifierPressed && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void pasteIntoInput(inputEl);
      return;
    }

    // Ignore other Ctrl/Cmd combos (like Cmd+C, Cmd+D, Cmd+P, etc.)
    if (isModifierPressed || event.ctrlKey || event.metaKey) return;

    // Ignore Alt combos
    if (event.altKey) return;

    // Plain Backspace
    if (event.key === "Backspace") {
      if (!inputEl.value) return;

      event.preventDefault();
      void prepareClipboardWindowEditableFocus().then(() => {
        deleteBackwardInInput(inputEl);
      });
      return;
    }

    // Ignore navigation / functional keys
    if (IGNORED_KEYS.has(event.key)) return;

    // Printable characters (length 1, excluding Space which is reserved for preview when list is active)
    if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      const char = event.key;
      void prepareClipboardWindowEditableFocus().then(() => {
        insertTextIntoInput(inputEl, char);
      });
    }
  };

  useKeyboardEvent("keydown", handleGlobalKeyDown);

  const handleGlobalPaste = (event: ClipboardEvent) => {
    if (!settings.clipboard?.search?.defaultFocus) return;
    if (isModalOpen()) return;

    const inputEl = inputRef.current?.input;
    if (!inputEl) return;

    const active = document.activeElement;
    if (active === inputEl) return;
    if (findEditableElement(active)) return;

    const pastedText = event.clipboardData?.getData("text/plain");
    if (!pastedText) return;

    event.preventDefault();
    void prepareClipboardWindowEditableFocus().then(() => {
      insertTextIntoInput(inputEl, pastedText);
    });
  };

  useEventListener("paste", handleGlobalPaste);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (composingRef.current) return;

    onChange?.(event);
  };

  const handleCompositionStart = (
    event: CompositionEvent<HTMLInputElement>,
  ) => {
    composingRef.current = true;

    onCompositionStart?.(event);
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;

    onCompositionEnd?.(event);
    // composition 结束时浏览器已派发最后一次 input，但被上面挡掉了，这里补一次。
    onChange?.(event as unknown as ChangeEvent<HTMLInputElement>);
  };

  return (
    <Input
      autoCapitalize="off"
      autoCorrect="off"
      data-allow-global-keyboard="true"
      key={clearToken}
      onChange={handleChange}
      onCompositionEnd={handleCompositionEnd}
      onCompositionStart={handleCompositionStart}
      prefix={
        <KeyHint
          hintKey="F"
          iconName="i-lucide:search"
          onKeyPress={focusSearch}
        />
      }
      ref={inputRef}
      spellCheck={false}
      {...rest}
    />
  );
};

export default SearchInput;
