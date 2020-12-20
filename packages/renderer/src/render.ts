import {bundle} from '@remotion/bundler';
import path from 'path';
import {VideoConfig} from 'remotion';
import {openBrowser, provideScreenshot} from '.';
import {getActualConcurrency} from './get-concurrency';

export const renderFrames = async ({
	fullPath,
	config,
	parallelism,
	onFrameUpdate,
	videoName,
	outputDir,
	onStart,
	userProps,
}: {
	fullPath: string;
	config: VideoConfig;
	parallelism?: number | null;
	onFrameUpdate: (f: number) => void;
	onStart: () => void;
	videoName: string;
	outputDir: string;
	userProps: unknown;
}) => {
	const actualParallelism = getActualConcurrency(parallelism ?? null);
	const busyPages = new Array(actualParallelism).fill(true).map(() => false);
	const getBusyPages = () => busyPages;

	const result = await bundle(fullPath);
	const browsers = await Promise.all(
		new Array(actualParallelism).fill(true).map(() => openBrowser())
	);
	const pages = await Promise.all(
		browsers.map((b) => {
			return b.newPage();
		})
	);
	const getFreePage = () =>
		new Promise<number>((resolve) => {
			let interval: number | NodeJS.Timeout | null = null;
			const resolveIfFree = () => {
				const freePage = getBusyPages().findIndex((p) => p === false);
				if (freePage !== -1) {
					busyPages[freePage] = true;
					resolve(freePage);
					if (interval) {
						clearInterval(interval as number);
					}
				} else {
					interval = setTimeout(resolveIfFree, 100);
				}
			};
			resolveIfFree();
		});
	const freeUpPage = (index: number) => {
		busyPages[index] = false;
	};
	const {durationInFrames: frames} = config;
	let framesRendered = 0;
	onStart();
	await Promise.all(
		new Array(frames)
			.fill(Boolean)
			.map((x, i) => i)
			.map(async (f) => {
				const freePageIdx = await getFreePage();
				const freePage = pages[freePageIdx];
				const site = `file://${result}/index.html?composition=${videoName}&frame=${f}&props=${encodeURIComponent(
					JSON.stringify(userProps)
				)}`;
				await provideScreenshot(freePage, {
					output: path.join(outputDir, `element-${f}.png`),
					site,
					height: config.height,
					width: config.width,
				});
				freeUpPage(freePageIdx);
				framesRendered++;
				onFrameUpdate(framesRendered);
			})
	);
	await Promise.all(browsers.map((browser) => browser.close()));
};