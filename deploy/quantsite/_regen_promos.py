# -*- coding: utf-8 -*-
"""Regenerate idle promo MP3s with persona Edge voices."""
from __future__ import annotations

import asyncio
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "audio"
OUT.mkdir(exist_ok=True)

JOBS = [
    {
        "file": "promo_zh_cn.mp3",
        "voice": "zh-CN-YunyangNeural",
        "rate": "-5%",
        "pitch": "-8Hz",
        "text": (
            "哎列位，天天儿熬大夜盯盘，累不累啊您呐？脑瓜子嗡嗡的吧！"
            "行情十回有八回都在那瞎晃荡，您跟它生哪门子闲气？"
            "听郭某人一句劝，交给我们这网格机器人儿！全天候搁那儿自动低买高卖，省心呐！"
            "赶紧点顶部【网格机器人】，免登录自个儿调参数，看看近三十天能给您挣出几屉包子钱！"
        ),
    },
    {
        "file": "promo_en_us.mp3",
        "voice": "en-US-ChristopherNeural",
        "rate": "-3%",
        "pitch": "-5Hz",
        "text": (
            "Listen, folks. You're staring at the charts all night. Terrible! Total disaster, believe me! "
            "The market just chops around, okay? Nobody knows trading better than me, and I'll tell you: "
            "our Grid Bot is tremendous. Absolutely huge! It buys low and sells high, twenty-four seven. "
            "Click Grid Bots at the top — no login, tune it yourself, see what thirty days can do for your portfolio. "
            "Make Your Portfolio Great Again!"
        ),
    },
    {
        "file": "promo_zh_tw.mp3",
        "voice": "zh-TW-HsiaoChenNeural",
        "rate": "+8%",
        "pitch": "+0Hz",
        "text": (
            "各位觀眾您好，若連續三十秒無實盤信號，歡迎前往頂部【網格機器人】"
            "免登入調參，以真實 K 線快速回測網格策略表現。"
        ),
    },
]


async def main() -> None:
    for job in JOBS:
        out = OUT / job["file"]
        comm = edge_tts.Communicate(job["text"], job["voice"], rate=job["rate"], pitch=job["pitch"])
        await comm.save(str(out))
        print(job["file"], job["voice"], out.stat().st_size)


if __name__ == "__main__":
    asyncio.run(main())
