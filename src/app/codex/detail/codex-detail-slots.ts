// The slots of the one detail shell, filled from inside a projected stage (concept batch-holotisch-kopf-vorlage).
// Item pages project head, stage, panel content and strip straight from their page template. The ship's
// holotable keeps every piece of its state in the stage component, so it cannot project: it declares its
// regions as templates (head band, panel head/body/foot, views row, below, strip) and hands them to the shell
// through this registry, which the shell provides. The shell renders them in its own slots — the templates keep
// the stage's bindings and styles wherever they stand — and lays out the grid; the stage owns no layout of its own.
import { ElementRef, Injectable, Signal, TemplateRef, inject, signal } from '@angular/core';

/** The regions a stage hands to the shell, one template each. */
export interface DetailSlotTemplates {
  /** Above the body: the head band and whatever stands right under it (a banner, the phone's switch). */
  readonly head: TemplateRef<unknown>;
  /** The panel's head (above the tab pill), its tabpanel content and its foot. */
  readonly panelHead: TemplateRef<unknown>;
  readonly panelBody: TemplateRef<unknown>;
  readonly panelFoot: TemplateRef<unknown>;
  /** The stage slot's foot: the row under the table and the panel. */
  readonly views: TemplateRef<unknown>;
  /** Between the body and the strip: the first screen's continuation. */
  readonly below: TemplateRef<unknown>;
  /** The KPI strip at the bottom. */
  readonly strip: TemplateRef<unknown>;
}

/** The arrival and phone state the shell's own boxes (the grid, the panel frame) follow. */
export interface DetailSlotState {
  /** The body pushes in (a ship opened after the session's first). */
  readonly push: boolean;
  /** The panel docks in from the side with a light edge. */
  readonly docking: boolean;
  /** The first ship is being revealed: the pane rises later and slower. */
  readonly reveal: boolean;
  /** The next ship is loading: the pane dims. */
  readonly dim: boolean;
  /** Reduced motion: no animation on the shell's boxes either. */
  readonly still: boolean;
  /** The phone's Tisch | Daten switch stands on Tisch: the panel is out. */
  readonly hideData: boolean;
}

/** What a stage registers with the shell. */
export interface DetailSlotSource {
  /** Null until every region template exists. */
  readonly slotTemplates: Signal<DetailSlotTemplates | null>;
  readonly slotState: Signal<DetailSlotState>;
  /** The open panel tab and the counts beside the profile's tab labels. */
  readonly panelTab: Signal<string>;
  readonly panelTabCounts: Signal<Readonly<Record<string, number>>>;
  /** A tab the reader picked in the shell's pill. */
  selectPanelTab(id: string): void;
}

/** Provided by the detail shell; a stage inside it finds it and fills the slots. */
@Injectable()
export class CodexDetailSlots {
  /** The shell's host: the box every slot stands in (measured sizes are set here). */
  readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  readonly source = signal<DetailSlotSource | null>(null);
}
