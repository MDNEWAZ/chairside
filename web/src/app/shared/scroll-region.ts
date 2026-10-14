import { AfterViewInit, DestroyRef, Directive, ElementRef, inject } from '@angular/core';

/**
 * Every `.table-wrap` that actually scrolls sideways becomes a named, keyboard-focusable region, so keyboard
 * users can scroll it with the arrow keys (WCAG 2.1.1). Tables that fit stay out of the tab order.
 */
@Directive({ selector: '.table-wrap' })
export class ScrollRegion implements AfterViewInit {
  private readonly el = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  private readonly destroyRef = inject(DestroyRef);

  ngAfterViewInit(): void {
    const update = () => {
      const scrolls = this.el.scrollWidth > this.el.clientWidth + 1;
      if (scrolls) {
        this.el.tabIndex = 0;
        this.el.setAttribute('role', 'region');
        const caption = this.el.querySelector('caption')?.textContent?.trim();
        this.el.setAttribute('aria-label', (caption || 'Table') + ' (scrolls sideways)');
      } else {
        this.el.removeAttribute('tabindex');
        this.el.removeAttribute('role');
        this.el.removeAttribute('aria-label');
      }
    };
    const observer = new ResizeObserver(update);
    observer.observe(this.el);
    const table = this.el.querySelector('table');
    if (table) observer.observe(table);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
