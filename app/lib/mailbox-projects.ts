export const PROJECT_CATEGORIES = [
	{ id: "ai", label: "AI 产品", description: "图像、视频、音乐生成与 AI 应用" },
	{ id: "games", label: "在线游戏", description: "每日谜题、问答与浏览器游戏" },
	{
		id: "guides",
		label: "游戏攻略与工具",
		description: "游戏指南、兑换码与玩家辅助工具",
	},
	{
		id: "tools",
		label: "实用工具",
		description: "音频处理、乐器、图形与创意工具",
	},
	{ id: "other", label: "待分类", description: "尚未归类的新项目" },
] as const;

export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]["id"];

// Categories follow the product's primary purpose, rather than its Worker name.
export const MAILBOX_PROJECTS: Record<
	string,
	{ category: ProjectCategory; description: string }
> = {
	"ai-hairstyle.org": { category: "ai", description: "AI 发型与形象设计" },
	"aigenmusic.com": { category: "ai", description: "AI 音乐生成" },
	"attractivenesstestlab.com": {
		category: "ai",
		description: "AI 人像反馈与分析",
	},
	"babyboogey.com": { category: "ai", description: "宝宝跳舞视频生成" },
	"foyria.com": { category: "ai", description: "房产视觉与营销素材生成" },
	"krea2.online": { category: "ai", description: "AI 图像生成" },
	"mangatrans.org": { category: "ai", description: "AI 漫画翻译" },
	"mp3totranscript.com": { category: "ai", description: "音频转录与字幕" },
	"outstanding-tiny-desk.com": {
		category: "ai",
		description: "照片转 Tiny Desk 视频",
	},
	"photo2ads.com": { category: "ai", description: "AI 商品广告素材" },
	"rain-dance-ai.com": { category: "ai", description: "AI 舞蹈与视频模板" },
	"scenemio.com": { category: "ai", description: "AI 视频模板" },
	"tagmint.app": { category: "ai", description: "AI 社交媒体标签生成" },
	"topview-t1.org": { category: "ai", description: "AI 视频生成" },
	"tuvimo.com": { category: "ai", description: "AI 游戏生成" },
	"whatbrandonthinks.net": {
		category: "ai",
		description: "聊天记录与关系分析",
	},
	"195-0.com": { category: "games", description: "World Draft 选人游戏" },
	"38-0.games": { category: "games", description: "足球选秀与赛季挑战" },
	"alldailygames.com": { category: "games", description: "每日益智游戏合集" },
	"ballfight.cc": { category: "games", description: "Ballfight 游戏" },
	"krillion.live": { category: "games", description: "每日文字游戏" },
	"lifeimmaculategrid.com": {
		category: "games",
		description: "生活主题九宫格问答",
	},
	"moviespot.org": { category: "games", description: "电影猜谜" },
	"pagerage.org": { category: "games", description: "网页破坏与解压游戏" },
	"playnoillirk.com": { category: "games", description: "每日问答与挑战" },
	"poople.top": { category: "games", description: "每日单词接龙" },
	"revolutionidle.org": { category: "games", description: "放置与增量游戏" },
	"size-it-up.org": { category: "games", description: "尺寸估算游戏" },
	"triviadrift.com": { category: "games", description: "每日知识问答" },
	"wonderhop.org": { category: "games", description: "像素风每日问答" },
	"2k27.org": { category: "guides", description: "NBA 2K27 球员构建与攻略" },
	"heartopia-codes.com": {
		category: "guides",
		description: "Heartopia 兑换码与指南",
	},
	"khajiitnamegenerator.xyz": {
		category: "guides",
		description: "上古卷轴角色名字生成",
	},
	"living-the-grid.net": {
		category: "guides",
		description: "Tomodachi Life 像素网格工具",
	},
	"palworldchromite.com": {
		category: "guides",
		description: "幻兽帕鲁矿物与材料指南",
	},
	"tavernlantern.com": {
		category: "guides",
		description: "D&D 角色与名字生成",
	},
	"tinyeden.org": { category: "guides", description: "Tiny Eden 游戏攻略" },
	"soundtools.online": { category: "tools", description: "浏览器音频处理工具" },
	"volume-shader.org": {
		category: "tools",
		description: "GPU 测试与着色器编辑",
	},
	"web-harmonium.online": {
		category: "tools",
		description: "在线风琴与音乐练习",
	},
	"yournameinlandsat.online": {
		category: "tools",
		description: "卫星影像名字生成",
	},
};

export function mailboxProject(domain: string) {
	return (
		MAILBOX_PROJECTS[domain.toLowerCase()] ?? {
			category: "other" as const,
			description: "待分类项目",
		}
	);
}

export function paginateProjects<T>(
	projects: T[],
	requestedPage: number,
	pageSize: number,
) {
	const size =
		Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) || 10 : 10;
	const totalPages = Math.max(1, Math.ceil(projects.length / size));
	const page = Math.min(
		totalPages,
		Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1),
	);
	const offset = (page - 1) * size;
	return {
		items: projects.slice(offset, offset + size),
		page,
		totalPages,
		start: projects.length ? offset + 1 : 0,
		end: Math.min(offset + size, projects.length),
	};
}
