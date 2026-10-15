import { Directive, ElementRef, inject } from '@angular/core';

/**
 * Keyboard support for a `role="tablist"`: Left/Right (and Up/Down) move between tabs, Home/End jump,
 * and only the selected tab is in the tab order (roving tabindex), as the ARIA tabs pattern expects.
 * Moving focus also activates the tab, so the panel follows the keyboard.
 */
@Directive({
  selector: '[role="tablist"]',
  host: { '(keydown)': 'onKey($event)', '(focusin)': 'syncTabIndex()' },
})
export class TabList {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;

  private tabs(): HTMLElement[] {
    return Array.from(this.el.querySelectorAll<HTMLElement>('[role="tab"]'));
  }

  syncTabIndex(): void {
    const tabs = this.tabs();
    const selected = tabs.find((t) => t.getAttribute('aria-selected') === 'true') ?? tabs[0];
    tabs.forEach((t) => (t.tabIndex = t === selected ? 0 : -1));
  }

  onKey(event: KeyboardEvent): void {
    const tabs = this.tabs();
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    const next = {
      ArrowRight: current + 1, ArrowDown: current + 1, ArrowLeft: current - 1, ArrowUp: current - 1, Home: 0, End: tabs.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    target.focus();
    target.click();
    setTimeout(() => this.syncTabIndex());
  }

  ngAfterViewInit(): void {
    this.syncTabIndex();
  }
}
