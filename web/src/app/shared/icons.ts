import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
  ArrowRight, BadgeCheck, Bell, Building2, CalendarCheck, CalendarDays, ChartGantt, Check, ChevronLeft, ChevronRight, CircleAlert,
  CircleCheck, Clock, ClipboardCheck, Download, Ellipsis, GripVertical, History, House, Info, LayoutDashboard, ListChecks, LogIn, LogOut,
  LucideAngularModule, LucideIconData, MapPin, Monitor, Moon, Plus, Rows3, ScrollText, Search, Send, Settings, ShieldCheck, Sparkles,
  SquarePen, Stethoscope, Sun, Timer, Trash2, TreePalm, TriangleAlert, Undo2, UserPlus, UserRound, Users, WandSparkles, X,
} from 'lucide-angular';

/** The one icon set (Lucide, 1.75 stroke). Named here so templates stay readable and the bundle only carries these. */
const ICONS = {
  'arrow-right': ArrowRight, 'badge-check': BadgeCheck, bell: Bell, building: Building2, 'calendar-check': CalendarCheck,
  calendar: CalendarDays, gantt: ChartGantt, check: Check, 'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  'circle-alert': CircleAlert, 'circle-check': CircleCheck, clock: Clock, clipboard: ClipboardCheck, download: Download,
  more: Ellipsis, grip: GripVertical, history: History, home: House, info: Info, dashboard: LayoutDashboard, checklist: ListChecks,
  'log-in': LogIn, 'log-out': LogOut, pin: MapPin, monitor: Monitor, moon: Moon, plus: Plus, rows: Rows3, audit: ScrollText,
  search: Search, send: Send, settings: Settings, shield: ShieldCheck, sparkles: Sparkles, edit: SquarePen, clinical: Stethoscope,
  sun: Sun, timer: Timer, trash: Trash2, leave: TreePalm, warning: TriangleAlert, undo: Undo2, 'user-plus': UserPlus,
  user: UserRound, users: Users, wand: WandSparkles, x: X,
} satisfies Record<string, LucideIconData>;

export type IconName = keyof typeof ICONS;

/** Decorative by default (aria-hidden). Give the parent control an accessible name. */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  host: { class: 'inline-flex shrink-0', 'aria-hidden': 'true' },
  template: `<lucide-icon [img]="data()" [size]="size()" [strokeWidth]="stroke()" />`,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly stroke = input(1.75);
  protected readonly data = computed(() => ICONS[this.name()]);
}
