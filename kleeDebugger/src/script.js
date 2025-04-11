document.addEventListener('DOMContentLoaded', () => {
    console.log('JavaScript loaded and running!');
    const p = document.createElement('p');
    p.textContent = 'JavaScript is working!';
    document.body.appendChild(p);
});

const data = [
    {
        "children":
            [
                "0x3563a70",
                "0x338fb30"
            ],
        "constraints": [],
        "id": 1,
        "instsSinceCovNew": 1,
        "name": "0x338f470",
        "pc": "/home/test/get_sign.c:17 0"
    },
    {
        "children": [],
        "constraints":
            [
                "a=0"
            ],
        "id": 1,
        "instsSinceCovNew": 1,
        "name": "0x338fb30",
        "pc": "/home/test/get_sign.c:9 5"
    },
    {
        "children":
            [
                "0x3563ef0",
                "0x3563800"
            ],
        "constraints":
            [
                "a!=0"
            ],
        "id": 2,
        "instsSinceCovNew": 1,
        "name": "0x3563a70",
        "pc": "/home/test/get_sign.c:11 7"
    },
    {
        "children": [],
        "constraints":
            [
                "a!=0",
                "a<0"
            ],
        "id": 2,
        "instsSinceCovNew": 1,
        "name": "0x3563800",
        "pc": "/home/test/get_sign.c:12 5"
    },
    {
        "children": [],
        "constraints":
            [
                "a!=0",
                "a>=0"
            ],
        "id": 3,
        "instsSinceCovNew": 1,
        "name": "0x3563ef0",
        "pc": "/home/test/get_sign.c:14 5"
    }
];

function findRootNode(data) {
    const allChildren = data.flatMap(item => item.children || []);  // 确保 children 是数组
    console.log("All Children:", allChildren);

    const root = data.find(item => !allChildren.includes(item.name));
    console.log("Root Node:", root);
    return root;
}

// 使用 findRootNode 来查找根节点
const root = findRootNode(data);

const nodesMap = new Map(data.map(d => [d.name, { ...d, children: [] }]));

data.forEach(node => {
    node.children.forEach(childName => {
        const childNode = nodesMap.get(childName);
        if (childNode) {
            nodesMap.get(node.name).children.push(childNode);
        }
    });
});

const rootNode = d3.hierarchy(nodesMap.get(root.name));

// 动态设置节点之间的水平和垂直间距，避免重叠
const treeLayout = d3.tree().nodeSize([120, 80]); // 每个节点的水平和垂直间距

// 设置 SVG 画布
// const svg = d3.select("svg")
//     .attr("viewBox", `0 0 1000 600`) // 设置初始视窗大小
//     .attr("preserveAspectRatio", "xMidYMid meet"); // 保持比例缩放
const svg = d3.select("svg");

// 创建缩放行为
const zoom = d3.zoom()
    .scaleExtent([0.5, 5])  // 设置缩放范围
    .on("zoom", (event) => {
        g.attr("transform", event.transform);  // 绑定缩放事件
        adjustSvgSize();  // 动态调整 SVG 尺寸
    });

svg.call(zoom);  // 将缩放行为绑定到 SVG

const g = svg.append("g").attr("transform", "translate(50,50)");

// 初始化计数器变量，用于给节点生成唯一 ID
let i = 0;
let firstLoad = true;  // 标志变量：检测是否是首次加载

function update(source) {
    // 确保树布局被正确计算
    treeLayout(rootNode);

    const nodes = rootNode.descendants();
    const links = rootNode.links();


    // 初始化或更新节点
    const node = g.selectAll(".node")
        .data(nodes, d => d.id || (d.id = ++i));

    const nodeEnter = node.enter()
        .append("g")
        .attr("class", "node")
        // 初始化节点的 transform，避免 undefined
        .attr("transform", d => `translate(${source.x0 || 0}, ${source.y0 || 0})`)
        .on("click", (event, d) => {
            console.log("Node clicked:", d.data.name); // 调试输出
            toggle(d); // 切换展开/折叠状态
            update(d); // 更新布局
        });

    nodeEnter.append("rect")
        .attr("width", d => d.data.name.length * 6 + 20) // 根据文字长度调整节点宽度
        .attr("height", 30) // 固定节点高度
        .attr("x", d => -(d.data.name.length * 3 + 10)) // 让矩形居中
        .attr("y", -15) // 垂直居中
        .attr("rx", 10) // 圆角半径，水平方向
        .attr("ry", 10); // 圆角半径，垂直方向

    nodeEnter.append("text")
        .attr("dy", 4)
        .attr("text-anchor", "middle")
        .text(d => d.data.constraints);

    const nodeUpdate = nodeEnter.merge(node);

    // 更新节点位置
    // nodeUpdate.transition()
    //     .duration(300)
    //     .attr("transform", d => {
    //         if (d.x === undefined || d.y === undefined) {
    //             console.error("Node position undefined:", d);
    //         }
    //         return `translate(${d.x || 0}, ${d.y || 0})`;
    //     })
    //     .on("end", () => fitToScreen());  // 在动画结束后调用 fitToScreen

    const transition = firstLoad ? nodeUpdate : nodeUpdate.transition().duration(300);

    // 更新节点位置
    transition.attr("transform", d => `translate(${d.x || 0}, ${d.y || 0})`);

    node.exit().transition()
        .duration(300)
        .attr("transform", d => `translate(${source.x || 0}, ${source.y || 0})`)
        .remove();

    // 更新连线
    const link = g.selectAll(".link")
        .data(links, d => d.target.id);

    const linkEnter = link.enter()
        .insert("path", "g")
        .attr("class", "link")
        .attr("d", d => {
            const o = { x: source.x0 || 0, y: source.y0 || 0 };
            return diagonal(o, o);
        });

    link.merge(linkEnter).transition()
        .duration(300)
        .attr("d", d => diagonal(d.source, d.target));

    link.exit().transition()
        .duration(300)
        .attr("d", d => {
            const o = { x: source.x || 0, y: source.y || 0 };
            return diagonal(o, o);
        })
        .remove();

    // 保存节点的当前坐标
    nodes.forEach(d => {
        d.x0 = d.x;
        d.y0 = d.y;
    });

    // 在首次加载完成后，将标志变量设为 false
    firstLoad = false;
}


function diagonal(s, d) {
    // const path = d3.path();
    // path.moveTo(s.x, s.y);
    // path.bezierCurveTo((s.x + d.x) / 2, s.y, (s.x + d.x) / 2, d.y, d.x, d.y);
    // return path.toString();
    // 检查 source 和 target 是否存在
    const sourceX = s.x;
    const sourceY = s.y + 15; // 父节点底部
    const targetX = d.x;
    const targetY = d.y - 15; // 子节点顶部

    // 控制点1：接近父节点底部
    const controlX1 = sourceX;
    const controlY1 = (sourceY + targetY) / 2;

    // 控制点2：接近子节点顶部
    const controlX2 = targetX;
    const controlY2 = (sourceY + targetY) / 2;

    // 使用 d3.path() 构建路径
    const path = d3.path();
    path.moveTo(sourceX, sourceY); // 从父节点底部开始
    path.bezierCurveTo(controlX1, controlY1, controlX2, controlY2, targetX, targetY); // 三次贝塞尔曲线

    return path.toString(); // 返回路径字符串
}
// .attr("marker-end", "url(#arrow)")
; // 应用箭头

function toggle(d) {
    if (d.children) {
        d._children = d.children;
        d.children = null;
    } else {
        d.children = d._children;
        d._children = null;
    }
}

// // 初始化时折叠所有子节点
// rootNode.children.forEach(collapse);

function collapse(d) {
    if (d.children) {
        d._children = d.children;
        d.children = null;
        d._children.forEach(collapse);
    }
}

update(rootNode);

// 动态调整 SVG 尺寸
function adjustSvgSize() {
    const bbox = g.node().getBBox();  // 获取内容的边界框
    svg.attr("width", bbox.width + bbox.x * 2)
        .attr("height", bbox.height + bbox.y * 2);
}

// 自动缩放和居中图像，留一点 padding 避免紧贴边缘
function fitToScreen(padding = 20) {
    const bbox = g.node().getBBox(); // 获取内容边界框
    console.log("BBox:", bbox);  // 打印 BBox 检查是否有效

    // 防止 BBox 返回负值的情况
    const width = Math.max(1, bbox.width);  // 最小宽度为 1，防止负值或 0
    const height = Math.max(1, bbox.height);  // 最小高度为 1

    const svgWidth = svg.node().clientWidth;
    const svgHeight = svg.node().clientHeight;

    const widthRatio = (svgWidth - padding * 2) / bbox.width;
    const heightRatio = (svgHeight - padding * 2) / bbox.height;
    const scale = Math.min(widthRatio, heightRatio); // 选择较小的缩放比例

    const x = (svgWidth - bbox.width * scale) / 2 - bbox.x * scale;
    const y = (svgHeight - bbox.height * scale) / 2 - bbox.y * scale;

    // 使用 transition 平滑移动到缩放后的视图
    svg.transition().duration(750).call(
        zoom.transform,
        d3.zoomIdentity.translate(x, y).scale(scale)
    );
}

// 初始调整 SVG 尺寸
//adjustSvgSize();
fitToScreen();