# multilingual-course-assistant

大学课程材料多语言问答：提问语言可以和材料语言不同（如英文提问、意大利语讲义）。基于 RAG 与开源权重 LLM（Qwen 系）+ Django + Celery/Redis 网站。

Triennale 毕业论文，佛罗伦萨大学（UniFi）信息工程 — relatore Prof. Marco Bertini。

## 状态

🔶 scaffold：只有文档 — 无应用代码、无测试、无 CI。里程碑与阻塞项见 [ROADMAP.md](ROADMAP.md)；约束、技术栈与决策见 [docs/architettura.md](docs/architettura.md)。

## Setup

```bash
git clone git@github.com:Zhengjunliang/multilingual-course-assistant.git
cd multilingual-course-assistant
```

无需安装依赖；环境搭建（uv、Python 3.12）🔜 M2，见 ROADMAP.md。

## 语言约定

开发期文档为中文；最终 tesi 交付物在 M6 译为意大利语。详见 [CLAUDE.md](CLAUDE.md) 文档约定一节。
