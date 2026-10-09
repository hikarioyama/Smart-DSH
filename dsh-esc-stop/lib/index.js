import z from "@deepseek-ai/schemastery";

/** The loader projects this entry's configuration to the browser forms service. */
const Config = z.object({
	enabled: z.boolean().default(true).volatile().description("Esc キーで実行中のターンを停止する")
});

/** The client owns the settings row; hide the duplicate automatic form. */
function apply(ctx) {
	ctx.inject(["settings"], (child) => {
		child.effect(() => child.settings.configure({ auto: false }, ctx.fiber));
	});
}

export { Config, apply };
