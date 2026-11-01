from typing import Literal

# 项目和标签共用的固定调色板：前端把这些名字映射成具体颜色，以后换主题时不用迁移数据
Color = Literal[
    "gray", "red", "orange", "amber", "green", "teal", "blue", "indigo", "violet", "pink"
]
