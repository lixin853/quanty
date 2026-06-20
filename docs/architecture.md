# 系统架构文档：QuantCompass

| 项目 | 内容 |
|------|------|
| 产品名称 | QuantCompass（量化罗盘） |
| 文档名称 | 系统架构文档 |
| 版本 | v0.1（草案） |
| 日期 | 2026-06-20 |
| 关联文档 | [PRD](./PRD.md) · [品牌](./branding.md) |

---

## 1. 架构目标与原则

QuantCompass 是面向普通人的「美股 + 加密」量化数据可视化工具。架构设计围绕以下原则：

1. **分层解耦**：数据层 → 信号层 → 回测层 → 展示层，每层职责单一、可独立测试。
2. **标的无关**：上层（指标 / 信号 / 回测 / 可视化）不感知美股与加密的差异，差异全部收敛在数据加载层。
3. **Point-in-time 优先**：任何信号 / 回测只能看到当时已知的数据，杜绝前视偏差（look-ahead bias）。
4. **可解释**：每个信号都能下钻到原始依据（新闻原文、指标数值）。
5. **原始数据与使用分离**：原始行情 / 新闻落地后不可变，情绪分等衍生数据单独存储、可重算。
6. **MVP 先快后优**：研究 / 验证阶段用 Streamlit 单体应用；产品化阶段再拆服务、换前端。

## 2. 总体架构（分层视图）

```
┌─────────────────────────────────────────────────────────────┐
│  展示层 (app/)         Streamlit + Plotly                      │
│  行情页 / 信号页 / 回测页 / 情绪页                              │
└───────────────▲─────────────────────────────────────────────┘
                │ 调用
┌───────────────┴─────────────────────────────────────────────┐
│  业务/服务层 (src/)                                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │indicators│  │ signals  │  │ backtest │  │sentiment │      │
│  │技术指标   │  │技术+情绪  │  │ vectorbt │  │ FinBERT  │      │
│  └────▲─────┘  └────▲─────┘  └────▲─────┘  └────▲─────┘      │
└───────┼─────────────┼─────────────┼─────────────┼───────────┘
        │             │             │             │ 读取
┌───────┴─────────────┴─────────────┴─────────────┴───────────┐
│  数据访问层 (src/loaders/)        统一 UTC 标准 OHLCV          │
│  ┌────────────┐         ┌────────────┐                       │
│  │ us_equity  │         │  crypto    │   ← base.py 抽象接口   │
│  │ yfinance   │         │  ccxt      │                       │
│  └─────▲──────┘         └─────▲──────┘                       │
└────────┼──────────────────────┼─────────────────────────────┘
         │ 拉取/缓存             │
┌────────┴──────────────────────┴─────────────────────────────┐
│  数据存储层 (data/)    Parquet (落地) + DuckDB (查询)          │
│  ohlcv/  news/  sentiment/  backtest_results/                 │
└──────────────────────────────────────────────────────────────┘
         ▲                                  ▲
         │ 外部数据源                        │
   行情: yfinance/Polygon/Alpaca · ccxt   新闻: AlphaVantage/EODHD/CryptoPanic
```

## 3. 分层职责

### 3.1 数据存储层 (`data/`)
- **格式**：Parquet（列式、压缩、读快），DuckDB 做 point-in-time SQL 查询。
- **目录**：`ohlcv/`（行情）、`news/`（原始新闻）、`sentiment/`（FinBERT 衍生分数）、`backtest_results/`。
- **不可变原则**：原始行情 / 新闻落地后只追加、不修改；情绪分单独存储，可基于 `news/` 重算。
- **不进版本库**：已在 `.gitignore` 覆盖（`data/`、`*.parquet`、`*.duckdb`）。

### 3.2 数据访问层 (`src/loaders/`)
整个架构的核心抽象。所有 loader 返回**完全一致**的标准格式，吸收美股 / 加密差异。

```python
# src/loaders/base.py
class OHLCVLoader(ABC):
    """所有行情 loader 的统一接口。
    返回 DataFrame：
      index   : pd.DatetimeIndex (UTC, tz-aware)
      columns : [open, high, low, close, volume]
    """
    @abstractmethod
    def load(self, symbol: str, start, end, timeframe: str) -> pd.DataFrame: ...
```

| 差异点 | us_equity.py | crypto.py |
|--------|-------------|-----------|
| 数据源 | yfinance / Polygon / Alpaca | ccxt |
| 复权 | 用复权价 | 无复权概念 |
| 交易日历 | `pandas-market-calendars` 对齐交易日 | 7×24 连续 |
| 时区 | 美东 → 统一转 UTC | 原生 UTC |

> 关键：上层模块只依赖 `base.py` 的接口，**永远不写 `if 美股 else 加密`**。

### 3.3 信号层 (`src/indicators/` + `src/signals/` + `src/sentiment/`)

- **`indicators/`**：纯技术指标（均线 / RSI / MACD / 动量），用 `pandas-ta`。输入输出均为标准 DataFrame，无副作用。
- **`sentiment/`**：
  - `fetch.py`：拉新闻，强制存 `published_at(UTC)`、`source`、`url`、`headline`、`body`。
  - `finbert.py`：FinBERT 打分，输出**连续概率 / logits**（非三分类标签，见 PRD 第 10 节实证），结果落地到 `data/sentiment/`，可重算。
- **`signals/`**：把技术信号与情绪信号**分别**输出，再给一个组合视图——**不揉成黑箱**。每个信号附「哪些因子在起作用」的理由，供展示层下钻。

### 3.4 回测层 (`src/backtest/`)
- 引擎：`vectorbt`（向量化、快，适合批量参数扫描）。
- **默认扣手续费 + 滑点**（费率在 `config.py` 配置）。
- 支持 **walk-forward 样本外验证**，对抗过拟合。
- 输出：累计收益 vs 基准（美股 SPY / 加密 BTC）、年化、最大回撤、Sharpe、胜率、交易次数 → 落地 `data/backtest_results/`。

### 3.5 展示层 (`app/`)
- **Streamlit 多页应用**：行情页 / 信号页 / 回测页 / 情绪页。
- 图表用 **Plotly**（交互式 K 线、缩放、指标叠加）。
- 关键术语带 tooltip；信号 / 分数可下钻到原始新闻与指标值。
- 全程展示免责声明（信号 / 回测 / 情绪分旁）。

## 4. 关键数据流

### 4.1 离线管道（定时 / 手动触发）
```
[行情源/新闻源]
   → loaders.fetch        拉取
   → 写入 data/ohlcv, data/news        原始落地（不可变）
   → sentiment.finbert    对新闻打连续情绪分
   → 写入 data/sentiment               衍生分数（可重算）
```

### 4.2 在线查询（用户交互时）
```
用户在 Streamlit 选标的/时间段
   → loaders.load (读 Parquet，DuckDB point-in-time 查询)
   → indicators + signals + sentiment 聚合
   → Plotly 渲染图表 + 信号卡片（含可解释理由）
```

### 4.3 回测流程
```
用户选 标的 + 时间段 + 内置策略
   → backtest (vectorbt, 扣费+滑点, walk-forward)
   → 绩效指标 + 收益曲线 vs 基准
   → 缓存到 data/backtest_results
```

## 5. 关键数据模型（Schema）

### 5.1 OHLCV（标准格式）
| 字段 | 类型 | 说明 |
|------|------|------|
| timestamp (index) | datetime, UTC tz-aware | 统一 UTC |
| open/high/low/close | float | 美股为复权价 |
| volume | float | 成交量 |

### 5.2 News（原始）
| 字段 | 类型 | 说明 |
|------|------|------|
| symbol | str | 关联标的 |
| published_at | datetime, UTC | **精确发布时间**，point-in-time 关键 |
| source | str | 来源 |
| headline / body | str | 标题 / 正文 |
| url | str | 原文链接（用于下钻） |

### 5.3 Sentiment（衍生，单独存储）
| 字段 | 类型 | 说明 |
|------|------|------|
| news_id | str | 关联原始新闻 |
| symbol | str | 标的 |
| scored_at | datetime, UTC | 打分时间 |
| sentiment_score | float | FinBERT **连续分**（非离散标签） |
| model_version | str | 模型版本，便于重算与对比 |

## 6. 横切关注点

| 关注点 | 处理方式 |
|--------|---------|
| **时区** | 全系统 UTC、tz-aware；美股转换在 loader 层完成 |
| **前视偏差** | 情绪用本地 FinBERT（非 LLM API）；回测只读 `published_at` 早于当时的新闻；优先 point-in-time 数据源 |
| **配置 / 密钥** | `pydantic-settings` + `.env`；API key 仅服务端，不下发客户端；`.env` 不进版本库 |
| **缓存 / 成本** | Parquet 落地复用；按标的池共享；对外部 API 限流，控制单用户成本 |
| **数据质量** | 入库前断言校验（缺口检测、去重、复权正确性），见 `tests/` |
| **可观测性** | 关键管道步骤日志（拉取量、打分量、回测耗时） |

## 7. 目录结构

```
stocks/
├── pyproject.toml          # uv 管理依赖
├── .env.example            # API key 模板（真 .env 不提交）
├── config.py               # 数据源、标的池、费率配置 (pydantic-settings)
├── data/                   # parquet 落地（.gitignore 覆盖）
│   ├── ohlcv/  news/  sentiment/  backtest_results/
├── src/
│   ├── loaders/            # base / us_equity / crypto → 统一 UTC OHLCV
│   ├── sentiment/          # fetch（存 published_at UTC）+ finbert（连续分）
│   ├── indicators/         # 均线 / RSI / MACD / 动量 (pandas-ta)
│   ├── signals/            # 技术信号 + 情绪信号（分开，不混黑箱）
│   └── backtest/           # vectorbt 封装，默认扣费 + 滑点
├── app/                    # Streamlit 多页：行情 / 信号 / 回测 / 情绪
├── notebooks/              # 研究探索
└── tests/                  # 数据校验断言（缺口 / 去重 / 复权）
```

## 8. 技术栈

| 层 | 选型 |
|----|------|
| 语言 / 依赖 | Python 3.11+ / `uv` |
| 美股行情 | `yfinance`（研究期）→ Polygon / Alpaca |
| 加密行情 | `ccxt` |
| 交易日历 | `pandas-market-calendars` |
| 存储 / 查询 | Parquet + `duckdb` |
| 技术指标 | `pandas-ta` |
| 新闻情绪 | `transformers` + FinBERT (`ProsusAI/finbert`) |
| 回测 | `vectorbt` |
| 可视化 | Streamlit + Plotly |
| 配置 | `pydantic-settings` + `.env` |

> 开源蓝本参考：`marketcalls/vectorbt-backtesting-skills`（美股 + 加密、成本建模、QuantStats 报告、策略模板）；`IsaacCheng9/quant-trading-strategy-backtester`（均值回归 / 配对 / walk-forward）。

## 9. 演进路线（架构视角）

| 阶段 | 架构形态 | 说明 |
|------|---------|------|
| **P0 数据层** | 单体脚本 + Parquet | 跑通拉数据 → FinBERT 情绪 → point-in-time 查询 |
| **P1 MVP** | Streamlit 单体应用 | 数据 / 信号 / 回测 / 可视化全在一个进程 |
| **P2 增强** | 拆离线管道（定时任务）与在线应用 | 情绪打分 / 回测预计算异步化 |
| **P3 产品化** | 后端 API（FastAPI）+ 独立前端 | Streamlit 退居研究内部工具，前端走产品级框架 |
| **P4（谨慎）** | 引入实盘对接 | 需独立的执行 / 风控服务与更强合规 |

---

*本架构文档为草案，与 `docs/PRD.md` 技术方案保持一致。下一步：进入 P0，落地 `loaders/base.py` 抽象与 FinBERT 情绪管道。*
