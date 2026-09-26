import { createProject, createIssue, makeEvidence, setEntities, type Project } from './domain';

export const SAMPLE_TEXT = `Title: 末班放映
Credit: ScriptGraph 原创教学短片

内景 老影院售票厅 - 黄昏 #1#

墙上的海报已经褪色。今晚是影院关门前的最后一场放映。

@林夏
散场以后，把放映室的钥匙还给我。

林夏将一把黄铜钥匙交给阿哲。阿哲把钥匙装进外套右边的口袋。

外景 影院后巷 - 黄昏 #2#

阿哲抱着装胶片的铁盒。林夏从他身后赶来。

@阿哲
片头少了十秒，观众会看出来吗？

@林夏
会。那十秒里有他们年轻时候的样子。

内景 放映室 - 傍晚 #3#

阿哲用黄铜钥匙打开房门，把胶片盒放在工作台上。他从口袋取出排片单。

@阿哲
七点整，最后一场。不能迟。

内景 老影院售票厅 - 夜 #4#

林夏正在门口检票。陈伯把一张折好的旧票根放在她手里。

@陈伯
今天不用找座位。我知道自己该坐哪里。

林夏把旧票根收进胸前的口袋。

内景 放映室 - 夜 #5#

投影忽然熄灭。阿哲从外套里掏出黄铜钥匙，准备去配电间。

@阿哲
别让他们走，我马上回来。

内景 放映室门口 - 夜 #6#

林夏从口袋里拿出黄铜钥匙，打开锁着的放映室。

@林夏
阿哲，你在哪里？

门后只有空转的胶片盘。林夏抬头看向配电间。

内景 观众厅 - 夜 #7#

银幕重新亮起。陈伯坐在第三排，手里攥着林夏刚收下的那张旧票根。

@陈伯
这次总算看到片头了。

外景 老影院门口 - 深夜 #8#

观众散去。林夏和阿哲站在拉下一半的卷帘门前。

@阿哲
明天这里就不放电影了吗？

@林夏
明天再说。今天，片子放完了。
`;

export const SAMPLE_REVISION = SAMPLE_TEXT
  .replace('林夏从口袋里拿出黄铜钥匙，打开锁着的放映室。', '林夏跑到配电间门口。阿哲将黄铜钥匙递给她。\n\n@阿哲\n你去看着胶片盘，我在这里合闸。\n\n林夏拿着黄铜钥匙返回，打开锁着的放映室。')
  .replace('银幕重新亮起。陈伯坐在第三排，手里攥着林夏刚收下的那张旧票根。', '银幕重新亮起。林夏在第三排找到陈伯，把胸前口袋里的旧票根还给他。陈伯小心地将票根夹进笔记本。')
  .replace('外景 老影院门口 - 深夜 #8#', '内景 配电间 - 夜 #7A#\n\n阿哲把跳闸的开关推回原位，走廊里传来观众的掌声。\n\n外景 老影院门口 - 深夜 #8#');

export function sampleProject(): Project {
  let project = createProject({ title: '末班放映 · 改稿示例', text: SAMPLE_TEXT, origin: 'sample', versionLabel: '初稿' });
  project = setEntities(project, [
    { kind: 'character', name: '林夏', aliases: [], confirmed: true },
    { kind: 'character', name: '阿哲', aliases: [], confirmed: true },
    { kind: 'character', name: '陈伯', aliases: [], confirmed: true },
    { kind: 'prop', name: '黄铜钥匙', aliases: ['钥匙'], confirmed: true },
    { kind: 'prop', name: '旧票根', aliases: ['票根'], confirmed: true },
    { kind: 'prop', name: '胶片盒', aliases: ['铁盒'], confirmed: true },
  ]);
  const version = project.versions[0];
  project = createIssue(project, { title: '补足黄铜钥匙的交接', note: '示例审阅任务：第5场钥匙仍在阿哲手里，第6场林夏直接用钥匙开门。请核对两场之间是否需要交接动作。', evidence: [makeEvidence(project, version.id, version.scenes[4].id), makeEvidence(project, version.id, version.scenes[5].id)] });
  project = createIssue(project, { title: '交代旧票根如何回到陈伯手里', note: '示例审阅任务：第4场林夏收下票根，第7场陈伯又持有同一张票根。可以补归还动作，也可以明确是另一张。', evidence: [makeEvidence(project, version.id, version.scenes[3].id), makeEvidence(project, version.id, version.scenes[6].id)] });
  return project;
}
