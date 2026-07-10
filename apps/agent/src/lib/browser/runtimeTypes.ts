export type LoadState = "domcontentloaded" | "load" | "networkidle";

export type PageViewportSize = {
	width: number;
	height: number;
};

export type BoundingBox = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type GotoOptions = {
	waitUntil?: LoadState;
	timeout?: number;
	referer?: string;
};

export type WaitForSelectorOptions = {
	timeout?: number;
	state?: "attached" | "visible" | "hidden";
};

export type WaitForOptions = {
	timeout?: number;
	state?: "visible" | "hidden";
};

export type LocatorFilterOptions = {
	hasText: string | RegExp;
};

export type ClickOptions = {
	timeout?: number;
	delay?: number;
	force?: boolean;
};

export type KeyboardPressOptions = {
	delay?: number;
};

type MouseMoveOptions = {
	steps?: number;
};

export type ElementEditableState = {
	connected: boolean;
	visible: boolean;
	editable: boolean;
	enabled: boolean;
	acceptsTextInput: boolean;
};

export interface ConsoleMessage {
	text(): string;
}

export interface Worker {
	evaluate(script: string): Promise<unknown>;
}

export interface Mouse {
	move(x: number, y: number, options?: MouseMoveOptions): Promise<void>;
	wheel(deltaX: number, deltaY: number): Promise<void>;
	click(x: number, y: number): Promise<void>;
}

export interface Keyboard {
	press(key: string, options?: KeyboardPressOptions): Promise<void>;
	type(text: string): Promise<void>;
	down(key: string): Promise<void>;
	up(key: string): Promise<void>;
}

export interface Locator {
	count(): Promise<number>;
	nth(index: number): Locator;
	first(): Locator;
	last(): Locator;
	filter(options: LocatorFilterOptions): Locator;
	getByText(text: string | RegExp): Locator;
	isVisible(options?: { timeout?: number }): Promise<boolean>;
	isEnabled(options?: { timeout?: number }): Promise<boolean>;
	focus(options?: { timeout?: number }): Promise<void>;
	boundingBox(options?: { timeout?: number }): Promise<BoundingBox | null>;
	scrollIntoViewIfNeeded(options?: { timeout?: number }): Promise<void>;
	click(options?: ClickOptions): Promise<void>;
	press(key: string, options?: KeyboardPressOptions): Promise<void>;
	waitFor(options?: WaitForOptions): Promise<void>;
	readInputValue(options?: { timeout?: number }): Promise<string>;
	setInputValue(value: string, options?: { timeout?: number }): Promise<void>;
	getEditableState(options?: { timeout?: number }): Promise<ElementEditableState>;
	dispatchClick(): Promise<void>;
}

export interface Page {
	goto(url: string, options?: GotoOptions): Promise<void>;
	evaluate<T, Arg = unknown>(
		pageFunction: (arg: Arg) => T | Promise<T>,
		arg: Arg,
	): Promise<T>;
	url(): string;
	getUrl(): Promise<string>;
	waitForTimeout(ms: number): Promise<void>;
	waitForLoadState(
		state?: LoadState,
		options?: { timeout?: number },
	): Promise<void>;
	waitForSelector(
		selector: string,
		options?: WaitForSelectorOptions,
	): Promise<void>;
	locator(selector: string): Locator;
	close(): Promise<void>;
	setDefaultTimeout(ms: number): void;
	setDefaultNavigationTimeout(ms: number): void;
	on(event: "console", listener: (message: ConsoleMessage) => void): void;
	on(event: "worker", listener: (worker: Worker) => void): void;
	context(): BrowserContext;
	viewportSize(): PageViewportSize | null;
	runDomOp<T>(operation: string, params?: unknown): Promise<T>;
	ping(): Promise<boolean>;
	screenshot(options?: {
		type?: "jpeg" | "png";
		quality?: number;
		fullPage?: boolean;
	}): Promise<Buffer>;
	mouse: Mouse;
	keyboard: Keyboard;
}

export type StorageStateOptions = {
	path?: string;
};

export type BrowserStorageState = {
	cookies: Array<{
		name: string;
		value: string;
		domain: string;
		path: string;
		expires: number;
		httpOnly: boolean;
		secure: boolean;
		sameSite: "Strict" | "Lax" | "None";
	}>;
	origins: Array<{
		origin: string;
		localStorage: Array<{ name: string; value: string }>;
	}>;
};

export interface BrowserContext {
	newPage(): Promise<Page>;
	close(): Promise<void>;
	storageState(options?: StorageStateOptions): Promise<BrowserStorageState>;
	addInitScript(script: string): Promise<void>;
	on(event: "page", listener: (page: Page) => void): void;
}

export interface Browser {
	version(): string;
	close(): Promise<void>;
}
