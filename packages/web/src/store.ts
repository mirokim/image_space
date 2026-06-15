/** 전역 상태(zustand) — 아이템·택소노미·공간 좌표·축/색 선택·ws 구독. */
import { create } from 'zustand';
import {
  ServerToUiSchema,
  type ImageItem,
  type SpaceResponse,
} from '@imgspace/shared';
import { api, WS_URL, type TaxonomyResponse } from './lib/api.js';

interface State {
  items: Record<string, ImageItem>;
  taxonomy: TaxonomyResponse | null;
  space: SpaceResponse | null;
  xAxis: string;
  yAxis: string;
  zAxis: string;
  colorBy: string;
  selectedId: string | null;
  connected: boolean;

  init: () => Promise<void>;
  setAxes: (x: string, y: string, z: string) => void;
  setColorBy: (key: string) => void;
  select: (id: string | null) => void;
  upload: (files: FileList | File[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refreshSpace: () => Promise<void>;
}

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export const useStore = create<State>((set, get) => ({
  items: {},
  taxonomy: null,
  space: null,
  xAxis: 'pca',
  yAxis: 'pca',
  zAxis: 'pca',
  colorBy: 'format',
  selectedId: null,
  connected: false,

  async init() {
    const taxonomy = await api.taxonomy();
    set({ taxonomy });
    connectWs(set, get);
    await get().refreshSpace();
  },

  setAxes(x, y, z) {
    set({ xAxis: x, yAxis: y, zAxis: z });
    void get().refreshSpace();
  },

  setColorBy(key) {
    set({ colorBy: key });
  },

  select(id) {
    set({ selectedId: id });
  },

  async upload(files) {
    const list = Array.from(files);
    for (const file of list) {
      const dataBase64 = await readAsDataUrl(file);
      const mime = file.type || 'image/png';
      try {
        await api.ingest(file.name, dataBase64, mime);
      } catch (err) {
        console.error('업로드 실패', file.name, err);
      }
    }
  },

  async remove(id) {
    await api.remove(id);
    set((s) => {
      const items = { ...s.items };
      delete items[id];
      return { items, selectedId: s.selectedId === id ? null : s.selectedId };
    });
    void get().refreshSpace();
  },

  async refreshSpace() {
    const { xAxis, yAxis, zAxis } = get();
    try {
      const space = await api.space(xAxis, yAxis, zAxis);
      set({ space });
    } catch (err) {
      console.error('space 갱신 실패', err);
    }
  },
}));

function scheduleRefresh(get: () => State) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void get().refreshSpace(), 350);
}

function connectWs(set: (p: Partial<State>) => void, get: () => State) {
  const ws = new WebSocket(WS_URL);
  ws.onopen = () => set({ connected: true });
  ws.onclose = () => {
    set({ connected: false });
    setTimeout(() => connectWs(set, get), 1500); // 재접속
  };
  ws.onmessage = (ev) => {
    let parsed;
    try {
      parsed = ServerToUiSchema.parse(JSON.parse(ev.data as string));
    } catch {
      return;
    }
    if (parsed.type === 'ui.snapshot') {
      const items: Record<string, ImageItem> = {};
      for (const it of parsed.items) items[it.id] = it;
      set({ items });
      scheduleRefresh(get);
    } else if (parsed.type === 'ui.itemUpdate') {
      set({ items: { ...get().items, [parsed.item.id]: parsed.item } });
      scheduleRefresh(get);
    } else if (parsed.type === 'ui.itemRemoved') {
      const items = { ...get().items };
      delete items[parsed.id];
      set({ items });
      scheduleRefresh(get);
    }
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
