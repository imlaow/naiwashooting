# naiwa-server

开一个 **奶蛙射击 (Naiwa Shootout)** 的联机服务器，朋友从官网的 **联机 / ONLINE** 按钮加入。
Run a server for **奶蛙射击 (Naiwa Shootout)**; friends join it from the official site's **联机 / ONLINE** button.

- 官网 / Official site: <https://naiwashootout.laow.dev>
- [中文](#中文) · [English](#english)

Commands marked *(not run here)* / *（未在本机运行）* weren't run while writing this guide: they
need an account, a domain or a machine that wasn't available. Everything else was run as written.

---

## 中文

### 你需要什么

- **Node.js 22 或更新**（用 `npx` 运行），或者 **Docker**。
- 一个 **`wss://` 地址**。官网是 HTTPS 页面，浏览器只允许它连 `wss://`（加密的 WebSocket）。服务器本身只说普通
  `ws://`，所以要在它前面放一个隧道或反向代理来提供 TLS（见下文「拿到 wss:// 地址」）。唯一的例外是同一台机器上测试：
  `ws://localhost:7777`。
- 一台很普通的机器：1 个 CPU 核心、512 MB–1 GB 内存就够（见「机器配置」）。

### 安装和启动

**npx**（最简单）：

```bash
mkdir naiwa && cd naiwa
npx naiwa-server@latest
```

npx 第一次会问 `Ok to proceed? (y)`，回答 `y`。第一次运行时，当前目录里没有 `server.json`，它会照着示例建一个并告诉你路径。改完 `server.json` 后重启（Ctrl+C 停止，再运行一次）。
封禁名单 `bans.json` 放在 `server.json` 旁边。也可以指定配置文件：`npx naiwa-server@latest /path/to/server.json`。

**Docker**（镜像 `ghcr.io/imlaow/naiwa-server`，linux/amd64 和 linux/arm64）：

```bash
docker run -dit --name naiwa --restart unless-stopped \
  -p 127.0.0.1:7777:7777 -v naiwa:/data ghcr.io/imlaow/naiwa-server:latest
docker logs naiwa
```

- `-dit`：后台运行，但保留终端，这样以后可以 `docker attach naiwa` 进入控制台（见「服主控制台」）。不加 `-it` 也能正常运行，只是没有控制台。
- `-p 127.0.0.1:7777:7777`：只在本机开放端口，给同一台机器上的隧道或 Caddy 用。Docker 发布的端口会绕过 ufw 防火墙，
  所以不要写成 `-p 7777:7777`，除非你确实想让局域网或公网直接连这个不加密的端口。
- `-v naiwa:/data`：`server.json` 和 `bans.json` 存在名为 `naiwa` 的卷里。第一次启动时会创建 `/data/server.json`。
  改配置：`docker exec -it naiwa vi /data/server.json`，然后 `docker restart naiwa`。
- 想直接在主机上编辑文件，就挂载一个目录。容器里的用户是 `node`（uid 1000），目录必须让它可写：

  ```bash
  mkdir naiwa-data && sudo chown 1000:1000 naiwa-data
  docker run -dit --name naiwa --restart unless-stopped \
    -p 127.0.0.1:7777:7777 -v "$PWD/naiwa-data:/data" ghcr.io/imlaow/naiwa-server:latest
  ```

- **用 Docker 时一定要设置 `trustProxy`**，见「trustProxy」一节，否则所有玩家看起来都来自同一个地址。

**Docker Compose**（`compose.yaml`，然后 `docker compose up -d`）：

```yaml
services:
  naiwa:
    image: ghcr.io/imlaow/naiwa-server:latest
    container_name: naiwa
    restart: unless-stopped
    stdin_open: true   # 控制台：docker attach naiwa
    tty: true
    ports:
      - "127.0.0.1:7777:7777"
    volumes:
      - naiwa:/data
volumes:
  naiwa:
```

**更新**：玩家看到「服务器版本 N，本站需要 M」时，就该更新了。npx：`npx naiwa-server@latest`（一定带 `@latest`，
否则 npx 可能一直用缓存里的旧版本）。Docker：`docker pull ghcr.io/imlaow/naiwa-server:latest`，再
`docker rm -f naiwa` 并用上面的命令重新 `docker run`（卷里的配置和封禁名单都会保留）。Compose：`docker compose pull && docker compose up -d`。

### server.json

没写的项用默认值。

| 项 | 含义 |
| --- | --- |
| `name` | 服务器名字（最多 32 字），显示在日志、玩家的加载画面和菜单、以及他们的「最近加入」里 |
| `motd` | 名字下面的一句话（最多 200 字，`""` 表示没有） |
| `port` | 本地 `ws://` 端口（默认 7777）。用 Docker 时改的是容器里的端口，`-p` 也要跟着改 |
| `mode` | `"coop"`（合作打怪）或 `"pvp"`（死斗） |
| `pvp` | `{ "killLimit": 25, "timeLimit": 600 }`：有人达到 killLimit 击杀（1–999）或过了 timeLimit 秒（30–3600）时一局结束 |
| `maxPlayers` | 同时最多几人（1–16，默认 4） |
| `password` | 密码，`""` 表示不要密码 |
| `maps` | 地图轮换，例如 `"island/cove"`、`"island/twins"`、`"factory/dairy"`、`"island/random"`（每次一个新岛） |
| `allowedOrigins` | 哪些网站的页面可以加入（默认是官网的几个域名和 `http://localhost:5173`），`["*"]` 表示任何网站 |
| `banAddresses` | `true`（默认）：封禁时也封玩家的 IP 地址，而不只是他的浏览器 |
| `trustProxy` | 你的隧道或反向代理的地址。只有从这些地址来的连接，才相信它们转发的 `X-Forwarded-For`（见下文） |
| `log` | `true`（默认）：有人加入、离开、掉线、回来时打印一行 |
| `stats` | `true`：每 10 秒打印每帧耗时、内存和每个玩家的发送流量 |

一局在第一个玩家进来 10 秒后开始。合作模式所有人倒地或死亡时结束，PvP 到击杀数或时间上限结束，然后显示 10 秒结果并换下一张地图。

### 拿到 wss:// 地址

#### 在本机测试

服务器启动后，在**同一台机器**的浏览器打开官网，点 联机 / ONLINE，地址填 `ws://localhost:7777`。浏览器把 localhost 当作安全的，
所以不需要 TLS。*（本次未运行；之前用 Chromium 测过，Safari 没测过。）*

#### Cloudflare 快速隧道（不需要账号和域名）

装 `cloudflared`（Linux arm64 是下面这个文件，amd64 把文件名换成 `cloudflared-linux-amd64`；macOS 用
`brew install cloudflared`，Windows 用 `winget install --id Cloudflare.cloudflared` *（这两条未在本机运行）*）：

```bash
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared
./cloudflared tunnel --url http://127.0.0.1:7777
```

它会打印 `https://<随机名字>.trycloudflare.com`，玩家填 `wss://<随机名字>.trycloudflare.com`（填 `https://…` 也行，会自动换成 `wss://`）。
每次运行名字都会变，适合临时开一局。不需要开放任何端口。`trustProxy` 用默认值（npx）或 Docker 的网关地址（见下文）。

#### Cloudflare 命名隧道（自己的域名，地址固定）

需要一个 Cloudflare 账号，并且域名在 Cloudflare 上。*（以下都未在本机运行。）*

```bash
cloudflared tunnel login
cloudflared tunnel create naiwa
cloudflared tunnel route dns naiwa naiwa.example.com
cloudflared tunnel run --url http://127.0.0.1:7777 naiwa
```

玩家填 `wss://naiwa.example.com`。也可以在 Cloudflare 控制台的 Zero Trust → Networks → Tunnels 里建隧道，把公共主机名指向
`http://127.0.0.1:7777`，再用控制台给的 `cloudflared service install <token>` 装成系统服务。`trustProxy` 和快速隧道一样。

#### Caddy（VPS 或家里的电脑）

Caddy 会自动申请 Let's Encrypt 证书。要求：域名的 A/AAAA 记录指向这台机器，80 和 443 端口能从外网访问（家里的话要在路由器上转发这两个端口）。
装 Caddy：`sudo apt install caddy`（Debian/Ubuntu *（未在本机运行）*，其他系统见 <https://caddyserver.com/docs/install>）。`/etc/caddy/Caddyfile`：

```
naiwa.example.com {
	reverse_proxy 127.0.0.1:7777
}
```

然后 `sudo systemctl reload caddy`。玩家填 `wss://naiwa.example.com`。*（真实域名和证书未在本机运行；同样的 `reverse_proxy` 配合 `tls internal`
在本机跑过，机器人通过它的 `wss://` 玩了完整一局。）* Caddy 会把它看到的地址写进 `X-Forwarded-For`，并丢掉客户端自己写的，所以 `trustProxy` 用默认值（npx）或 Docker 网关地址。

#### Cloudflare 代理（橙色云朵）在 Caddy 前面

这时 Caddy 看到的是 Cloudflare 边缘节点的地址，默认会把它写成 `X-Forwarded-For` 的最后一项，服务器就会把所有人都当成 Cloudflare。
要让 Caddy 相信 Cloudflare 的地址段，从 `CF-Connecting-IP` 取出玩家的真实地址，再只把这个地址转发过去：

```
{
	servers {
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
		client_ip_headers Cf-Connecting-Ip
	}
}
naiwa.example.com {
	reverse_proxy 127.0.0.1:7777 {
		header_up X-Forwarded-For {client_ip}
	}
}
```

这些是 2026-10-19 时 Cloudflare 的地址段，最新的在 <https://www.cloudflare.com/ips/>。不是从这些地址段来的请求（绕过 Cloudflare 直接连你的机器），
`CF-Connecting-IP` 会被忽略，用的是连接本身的地址。`trustProxy` 不变（只写 Caddy 所在的地址）。*（在本机用 127.0.0.1 代替 Cloudflare 的地址段跑过：
从“Cloudflare”来的请求得到 `CF-Connecting-IP` 里的地址；直接连过来、伪造了 `CF-Connecting-IP` 的请求得到它自己的地址；没有 `header_up`
那一行时，服务器看到的是“Cloudflare”的地址。）*

#### 原始 TCP 隧道（playit.gg、ngrok tcp、ssh -R）

不推荐：它们只转发字节，不提供 TLS，所以官网上的浏览器不能直接通过它们加入（需要 `wss://`）。如果你还是用了（比如在它的另一端自己加了 TLS），
注意它们会把客户端自己写的 `X-Forwarded-For` 原样带过来，而连接看起来来自 127.0.0.1。这时必须设置 **`"trustProxy": []`**，
否则任何人都能随便写一个地址，让封禁落到别人身上。例外：如果隧道的公网那一端只能经过一个会自己写 `X-Forwarded-For` 的代理
（例如 VPS 上的 Caddy 转发到 `ssh -R` 在 VPS 本机开的端口），那就保留默认值。*（这几个工具都未在本机运行；“客户端自己写的地址被相信”这件事用一个本地 TCP 转发程序验证过，
默认 `trustProxy` 时玩家显示为伪造的地址，`[]` 时显示为 127.0.0.1。）*

### trustProxy

服务器只在连接来自 `trustProxy` 里的地址时，才相信 `X-Forwarded-For` 的**最后一项**（也就是那个代理自己写的）。
其他连接一律用连接本身的地址，不管它声称什么。

| 你的设置 | `trustProxy` |
| --- | --- |
| npx，隧道或 Caddy 在同一台机器上 | 默认值 `["127.0.0.1", "::1"]` |
| Docker（`docker run`），隧道或 Caddy 在主机上 | `["172.17.0.1"]`（默认 bridge 网络的网关） |
| Docker Compose，隧道或 Caddy 在主机上 | 该项目网络的网关，例如 `["172.22.0.1"]` |
| Cloudflare 代理在 Caddy 前面 | 只写 Caddy 的地址（同上），另外按上面配置 Caddy |
| 原始 TCP 隧道（playit.gg、ngrok tcp、ssh -R） | `[]` |

- **Docker 为什么不同**：主机上的程序连 `127.0.0.1:7777` 时，经过 Docker 的端口转发，容器看到的来源是网络的网关地址（`172.17.0.1`），
  不是 127.0.0.1。查网关：`docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'`（Compose 把 `bridge` 换成
  `<目录名>_default`）。
- **最简单的办法**：第一个玩家通过隧道进来后看日志。如果代理没被信任，服务器会打印一行
  `a connection from 172.17.0.1 came through a proxy …`，把那个地址加进 `trustProxy` 再重启即可。
- 没设置好会怎样：所有玩家都显示为代理的地址，用 `ban` 封一个人的地址就会封掉所有人（服务器不会封 `trustProxy` 里的地址和本机地址，只按浏览器封）。

### 服主控制台

服主在服务器运行的终端里输入命令。控制台不在网络上，所以没有密码：能用这个终端的人就是服主。

| 命令 | 作用 |
| --- | --- |
| `players`（或 `list`） | 谁在线：编号（`#3`）、加载中/游戏中/掉线、地址、延迟，以及最近离开的 10 个人 |
| `kick <玩家>` | 立刻踢出，可以再进来 |
| `ban <玩家\|地址>` | 踢出并封禁：玩家按浏览器 id 和地址封；地址会把从那里来的人都踢掉。刚离开的人（`players` 里列出的）也能封 |
| `bans` | 封禁名单（`bans.json`） |
| `unban <编号\|名字\|地址>` | 解封（编号是 `bans` 里的） |
| `say <文字>` | 以服务器身份给所有人发一句话（聊天里显示 `[Server]: …`） |
| `map [主题/编号\|next]` | 马上换地图（不带参数：显示当前地图和轮换） |
| `restart` | 当前地图从头开始 |
| `help` | 命令列表 |

`<玩家>` 是 `players` 里的编号（`3` 或 `#3`）或名字。

**怎样进入控制台：**

- **npx**：就是你运行它的那个终端，直接打字。
- **后台运行但保留控制台**：用 tmux。`tmux new -s naiwa` 打开一个会话，在里面运行 `npx naiwa-server@latest`，
  按 Ctrl+B 再按 D 离开，`tmux attach -t naiwa` 回来。（别写成 `tmux new -s naiwa 'npx …'`：用 nvm 装的 node 时，
  tmux 直接运行的命令找不到 npx，会话马上就没了。）（不要用 `npx naiwa-server &` 放到后台：那样服务器照常运行，但没有控制台。）
- **Docker**：用 `-dit` 启动，`docker attach naiwa` 进入。按 **Ctrl+P 再按 Ctrl+Q** 离开，服务器继续运行。
  在 attach 里按 **Ctrl+C 会停掉服务器**（`--restart unless-stopped` 也不会重启它，用 `docker start naiwa` 重新启动）。
  attach 后看不到之前的输出，用 `docker logs naiwa` 看。没用 `-it` 启动的容器没有控制台（日志里会有一行 `stdin ended`），要用的话以 `-dit` 重新创建。
- **Docker Compose**：`docker attach naiwa`（或 `docker compose attach naiwa`），同样用 Ctrl+P Ctrl+Q 离开。
- **系统服务（systemd）**：服务没有终端，所以没有控制台，服务器照常运行。需要控制台就用 tmux。示例
  `/etc/systemd/system/naiwa.service`（先 `npm install -g naiwa-server`，`which node` 和 `npm root -g` 给出下面两个路径）：

  ```ini
  [Unit]
  Description=naiwa-server
  After=network-online.target

  [Service]
  User=naiwa
  WorkingDirectory=/home/naiwa
  ExecStart=/usr/bin/node /usr/lib/node_modules/naiwa-server/server/cli.js
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```

  然后 `sudo systemctl enable --now naiwa`，日志用 `journalctl -u naiwa -f`。*（这个系统服务未在本机安装；同样的命令（`node …/naiwa-server/server/cli.js`，本地安装）
  用 `systemd-run --user` 跑过。注意 `ExecStart` 要写 node 的完整路径：用 nvm 装的 node 不在 systemd 的 PATH 里。）*

### 封禁和 bans.json

- 封禁按两样东西：玩家浏览器里保存的随机 id，以及他连接的地址（`"banAddresses": false` 时只按 id）。任何一样对上就拒绝加入，玩家会看到「你被这个服务器封禁了」。
- IPv6 地址按 /64 封（设备会自己换后半段）。本机地址和 `trustProxy` 里的地址不会被封，这时只按浏览器 id 封。
- `bans.json` 在 `server.json` 旁边（Docker 里是 `/data/bans.json`）。每次 `ban`/`unban` 都会整个重写。手动编辑后要重启才生效；
  文件写坏了，服务器会拒绝启动并说明原因，而不是清空它。
- 这只是减速带，跟 Minecraft 的 IP 封禁一样：换个网络（手机流量、VPN、重启路由器）或换个浏览器（隐私窗口、清除网站数据）就能回来；
  很多人共用的地址（运营商 NAT、学校）会连带封掉其他人。真正的门槛是 `password`。

### 防火墙和端口

- 服务器只用 TCP（WebSocket），默认端口 7777，不需要 UDP。
- **用隧道**（快速或命名隧道）：不需要开放任何入站端口，7777 只给本机的 `cloudflared` 用。
- **用 Caddy**：开放 TCP 80 和 443（80 用于证书申请和跳转），7777 不要对外开放。
  `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp` *（未在本机运行）*。云服务器还要在服务商的防火墙
  （安全组、Oracle 的 Security List）里放行这两个端口；家里的电脑要在路由器上把它们转发过来。
- Docker 发布的端口不受 ufw 管，所以用 `-p 127.0.0.1:7777:7777`。
- 普通的 `ws://` 端口对外开放没有用：官网上的浏览器不会连非本机的 `ws://`。

### 中国大陆的玩家

Cloudflare 的隧道（包括 `trycloudflare.com`）走的是大陆以外的节点，大陆玩家可能延迟高或不稳定。玩家多在大陆的话，
放在附近的 VPS（香港、东京、新加坡）上用 Caddy 通常更好。服务器放在大陆境内的话，用域名在 80/443 端口提供服务需要 ICP 备案。*（未从大陆测试。）*

### 机器配置

1 个 vCPU、512 MB–1 GB 内存就够：最便宜的 VPS、Oracle 免费机型、树莓派 4/5、或者任何家用电脑。按玩家的延迟选位置。
上传带宽比 CPU 更要紧：合作激战时每个玩家最多约 16 KB/s。在本机（ARM Neoverse-N1，Node 24）用机器人实测：

| 模式 | 玩家 | CPU（一个核心的） | 内存 | 每个玩家上传 | 总上传（峰值） |
| --- | --- | --- | --- | --- | --- |
| 合作，第 8 波起 | 4 | 5.3 % | 102–121 MB | 平均 7.5 KB/s，峰值 12.5 | 0.4 Mbps |
| 合作，第 8 波起 | 8 | 8.0 % | 95–122 MB | 平均 10.9 KB/s，峰值 16.4 | 1.0 Mbps |
| PvP | 4 | 3.7 % | 91–106 MB | 平均 2.3 KB/s，峰值 2.8 | 0.1 Mbps |
| PvP | 8 | 6.0 % | 92–117 MB | 平均 4.9 KB/s，峰值 5.7 | 0.4 Mbps |

（每种 3 分钟，2026-10-19。8 人时每帧平均 0.45 ms，60 帧每秒的预算是 16.7 ms。）


---

## English

### What you need

- **Node.js 22 or newer** (to run it with `npx`), or **Docker**.
- A **`wss://` address**. The official site is an HTTPS page, so browsers only let it open `wss://`
  (encrypted WebSocket). The server itself speaks plain `ws://`, so a tunnel or reverse proxy in
  front of it provides the TLS (see "Getting a wss:// address"). The one exception is testing on
  the same machine: `ws://localhost:7777`.
- A very ordinary machine: 1 CPU core and 512 MB–1 GB of memory (see "Machine size").

### Install and start

**npx** (simplest):

```bash
mkdir naiwa && cd naiwa
npx naiwa-server@latest
```

npx asks `Ok to proceed? (y)` the first time: answer `y`. On a first run, with no `server.json` in the current directory, it creates one from the example
and says where. Edit `server.json`, then restart (Ctrl+C, and run it again) to apply it. The ban
list, `bans.json`, is kept next to `server.json`. Another config file:
`npx naiwa-server@latest /path/to/server.json`.

**Docker** (image `ghcr.io/imlaow/naiwa-server`, linux/amd64 and linux/arm64):

```bash
docker run -dit --name naiwa --restart unless-stopped \
  -p 127.0.0.1:7777:7777 -v naiwa:/data ghcr.io/imlaow/naiwa-server:latest
docker logs naiwa
```

- `-dit`: in the background, but with a terminal kept, so `docker attach naiwa` reaches the
  console later (see "The owner's console"). Without `-it` it runs the same, with no console.
- `-p 127.0.0.1:7777:7777`: the port on this machine only, for a tunnel or Caddy on the same
  machine. Ports Docker publishes bypass ufw, so don't write `-p 7777:7777` unless you mean the LAN
  or the internet to reach this unencrypted port.
- `-v naiwa:/data`: `server.json` and `bans.json` live in a volume named `naiwa`. The first start
  creates `/data/server.json`. To change it: `docker exec -it naiwa vi /data/server.json`, then
  `docker restart naiwa`.
- To edit the files on the host, mount a directory instead. The image runs as `node` (uid 1000),
  which must be able to write it:

  ```bash
  mkdir naiwa-data && sudo chown 1000:1000 naiwa-data
  docker run -dit --name naiwa --restart unless-stopped \
    -p 127.0.0.1:7777:7777 -v "$PWD/naiwa-data:/data" ghcr.io/imlaow/naiwa-server:latest
  ```

- **With Docker, set `trustProxy`** (see "trustProxy"), or every player looks like one address.

**Docker Compose** (`compose.yaml`, then `docker compose up -d`):

```yaml
services:
  naiwa:
    image: ghcr.io/imlaow/naiwa-server:latest
    container_name: naiwa
    restart: unless-stopped
    stdin_open: true   # the console: docker attach naiwa
    tty: true
    ports:
      - "127.0.0.1:7777:7777"
    volumes:
      - naiwa:/data
volumes:
  naiwa:
```

**Updating:** when players see "server runs version N, this site needs M", update. npx:
`npx naiwa-server@latest` (always with `@latest`, or npx may keep running the old version it has
cached). Docker: `docker pull ghcr.io/imlaow/naiwa-server:latest`, then `docker rm -f naiwa` and
the same `docker run` as above (the config and bans in the volume stay). Compose:
`docker compose pull && docker compose up -d`.

### server.json

Any key left out takes its default.

| Key | Meaning |
| --- | --- |
| `name` | The server's name (up to 32 characters): in its log, on the players' loading screen and menu, and in their recently joined servers |
| `motd` | A line under the name (up to 200 characters, `""` for none) |
| `port` | The local `ws://` port (default 7777). In Docker this is the container's port: change `-p` with it |
| `mode` | `"coop"` (waves of enemies) or `"pvp"` (deathmatch) |
| `pvp` | `{ "killLimit": 25, "timeLimit": 600 }`: a round ends when someone reaches killLimit kills (1–999) or after timeLimit seconds (30–3600) |
| `maxPlayers` | Players at once (1–16, default 4) |
| `password` | `""` for none |
| `maps` | The rotation, e.g. `"island/cove"`, `"island/twins"`, `"factory/dairy"`, `"island/random"` (a new island each time) |
| `allowedOrigins` | Sites whose pages may join (the official domains and `http://localhost:5173` by default); `["*"]` for any |
| `banAddresses` | `true` (default): a ban also refuses the player's address, not only their browser |
| `trustProxy` | Your tunnel's or reverse proxy's address. Only connections from these have their forwarded `X-Forwarded-For` believed (see below) |
| `log` | `true` (default): a line when someone joins, leaves, loses the connection or comes back |
| `stats` | `true`: time per tick, memory and bytes sent per player every 10 s |

A run starts 10 s after the first player is in. Co-op ends when everyone is down or dead, PvP at
the kill or time limit; the results show for 10 s and the next map comes.

### Getting a wss:// address

#### Testing on this machine

With the server running, open the official site in a browser on **the same machine**, click
联机 / ONLINE and enter `ws://localhost:7777`. Browsers treat localhost as secure, so no TLS is
needed. *(Not run this time; checked earlier in Chromium. Safari wasn't checked.)*

#### Cloudflare quick tunnel (no account, no domain)

Get `cloudflared` (this is the Linux arm64 file; for amd64 use `cloudflared-linux-amd64`; on macOS
`brew install cloudflared`, on Windows `winget install --id Cloudflare.cloudflared` *(those two not
run here)*):

```bash
curl -L -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64
chmod +x cloudflared
./cloudflared tunnel --url http://127.0.0.1:7777
```

It prints `https://<random>.trycloudflare.com`; players enter `wss://<random>.trycloudflare.com`
(`https://…` works too and becomes `wss://`). The name changes on every run, so it suits a game
tonight. No port needs opening. `trustProxy`: the default (npx) or Docker's gateway (below).

#### Cloudflare named tunnel (your own domain, a fixed address)

Needs a Cloudflare account with your domain on it. *(None of this was run here.)*

```bash
cloudflared tunnel login
cloudflared tunnel create naiwa
cloudflared tunnel route dns naiwa naiwa.example.com
cloudflared tunnel run --url http://127.0.0.1:7777 naiwa
```

Players enter `wss://naiwa.example.com`. Or create the tunnel in the Cloudflare dashboard (Zero
Trust → Networks → Tunnels) with a public hostname pointing at `http://127.0.0.1:7777`, and install
it as a service with the `cloudflared service install <token>` it shows. `trustProxy` as for the
quick tunnel.

#### Caddy (a VPS or a home machine)

Caddy gets a Let's Encrypt certificate by itself. It needs the domain's A/AAAA record pointing at
the machine, and ports 80 and 443 reachable from the internet (at home, forward both on the
router). Install it with `sudo apt install caddy` (Debian/Ubuntu *(not run here)*; other systems:
<https://caddyserver.com/docs/install>). `/etc/caddy/Caddyfile`:

```
naiwa.example.com {
	reverse_proxy 127.0.0.1:7777
}
```

Then `sudo systemctl reload caddy`. Players enter `wss://naiwa.example.com`. *(A real domain and
certificate weren't run here; the same `reverse_proxy` with `tls internal` was, and bots played a
whole run through its `wss://`.)* Caddy writes the address it saw into `X-Forwarded-For` and drops
whatever the client wrote there, so `trustProxy` is the default (npx) or Docker's gateway.

#### Cloudflare's proxy (the orange cloud) in front of Caddy

Caddy then sees Cloudflare's edge, and by default writes that as the last `X-Forwarded-For`
entry, so the server would take everyone for Cloudflare. Make Caddy trust Cloudflare's ranges,
take the player's address from `CF-Connecting-IP`, and forward only that:

```
{
	servers {
		trusted_proxies static 173.245.48.0/20 103.21.244.0/22 103.22.200.0/22 103.31.4.0/22 141.101.64.0/18 108.162.192.0/18 190.93.240.0/20 188.114.96.0/20 197.234.240.0/22 198.41.128.0/17 162.158.0.0/15 104.16.0.0/13 104.24.0.0/14 172.64.0.0/13 131.0.72.0/22 2400:cb00::/32 2606:4700::/32 2803:f800::/32 2405:b500::/32 2405:8100::/32 2a06:98c0::/29 2c0f:f248::/32
		client_ip_headers Cf-Connecting-Ip
	}
}
naiwa.example.com {
	reverse_proxy 127.0.0.1:7777 {
		header_up X-Forwarded-For {client_ip}
	}
}
```

Those are Cloudflare's ranges on 2026-10-19; the current list is at
<https://www.cloudflare.com/ips/>. A request from outside them (someone going around Cloudflare to
your machine) has its `CF-Connecting-IP` ignored and counts as its own address. `trustProxy` stays
as it was (Caddy's address only). *(Run here with 127.0.0.1 standing in for Cloudflare's ranges: a
request from "Cloudflare" got the address in `CF-Connecting-IP`; a direct one with a forged
`CF-Connecting-IP` got its own; without the `header_up` line the server saw "Cloudflare".)*

#### Raw TCP tunnels (playit.gg, ngrok tcp, ssh -R)

Not recommended: they pass bytes and add no TLS, so browsers on the official site can't join
through them by themselves (they need `wss://`). If you use one anyway (with TLS added at its far
end, say), know that it brings along whatever `X-Forwarded-For` the client wrote, on a connection
that seems to come from 127.0.0.1. Then set **`"trustProxy": []`**, or anyone could write any
address and have a ban land on someone else. The exception: when the tunnel's public end is only
reachable through a proxy that writes `X-Forwarded-For` itself (Caddy on a VPS forwarding to the
port `ssh -R` opened on the VPS's loopback), keep the default. *(None of these tools were run here;
that the client's own header is believed was checked with a local TCP relay: with the default
`trustProxy` the player showed the forged address, with `[]` 127.0.0.1.)*

### trustProxy

Only for a connection from an address in `trustProxy` does the server believe the **last**
`X-Forwarded-For` entry (the one that proxy wrote itself). Any other connection is its own
address, whatever it claims.

| Your setup | `trustProxy` |
| --- | --- |
| npx, with the tunnel or Caddy on the same machine | the default, `["127.0.0.1", "::1"]` |
| Docker (`docker run`), the tunnel or Caddy on the host | `["172.17.0.1"]` (the default bridge network's gateway) |
| Docker Compose, the tunnel or Caddy on the host | the project network's gateway, e.g. `["172.22.0.1"]` |
| Cloudflare's proxy in front of Caddy | Caddy's address only (as above), and Caddy set up as shown |
| A raw TCP tunnel (playit.gg, ngrok tcp, ssh -R) | `[]` |

- **Why Docker differs:** when a program on the host connects to `127.0.0.1:7777`, Docker's port
  mapping hands it over from the network's gateway (`172.17.0.1`), not 127.0.0.1. The gateway:
  `docker network inspect bridge --format '{{(index .IPAM.Config 0).Gateway}}'` (for Compose,
  `<directory>_default` instead of `bridge`).
- **The easy way:** after the first player has come in through the tunnel, look at the log. When
  the proxy isn't trusted, the server prints `a connection from 172.17.0.1 came through a proxy …`;
  add that address to `trustProxy` and restart.
- If it's wrong: every player shows as the proxy's address, and `ban` on one player's address would
  refuse everyone. (The server never bans `trustProxy` addresses or this machine's own, and bans by
  browser alone then.)

### The owner's console

The owner types commands into the terminal the server runs in. It isn't on the network, so there
is no password: whoever has the terminal is the owner.

| Command | Does |
| --- | --- |
| `players` (or `list`) | who is here: number (`#3`), loading / playing / away, address, ping; and the last 10 who left |
| `kick <player>` | out at once; they may join again |
| `ban <player\|address>` | out, and refused from now on: a player by browser id and address; an address with everyone here from it. Someone who just left (listed by `players`) can be banned too |
| `bans` | the ban list (`bans.json`) |
| `unban <n\|name\|address>` | lift a ban (`n`: its number in `bans`) |
| `say <text>` | a line to everyone from the server (`[Server]: …` in the chat) |
| `map [theme/id\|next]` | another map now (no argument: this one and the rotation) |
| `restart` | this map from its start |
| `help` | the list |

A `<player>` is their number in `players` (`3` or `#3`) or their name.

**Reaching the console:**

- **npx:** the terminal you started it in; just type.
- **In the background, keeping the console:** tmux. `tmux new -s naiwa` opens a session; run
  `npx naiwa-server@latest` in it, Ctrl+B then D to leave it, `tmux attach -t naiwa` to come back.
  (Not `tmux new -s naiwa 'npx …'`: with a node installed by nvm, a command tmux runs directly
  doesn't find npx, and the session ends at once.) (Not `npx naiwa-server &`: the
  server runs, but without a console.)
- **Docker:** start it with `-dit`, then `docker attach naiwa`. **Ctrl+P then Ctrl+Q** leaves and
  the server runs on. **Ctrl+C in an attach stops the server** (and `--restart unless-stopped`
  won't bring it back: `docker start naiwa`). An attach doesn't show earlier output: that's
  `docker logs naiwa`. A container started without `-it` has no console (its log says
  `stdin ended`); create it again with `-dit` for one.
- **Docker Compose:** `docker attach naiwa` (or `docker compose attach naiwa`); Ctrl+P Ctrl+Q leaves.
- **A service (systemd):** a service has no terminal, so no console; the server runs the same.
  Use tmux when you want the console. An example `/etc/systemd/system/naiwa.service` (after
  `npm install -g naiwa-server`; `which node` and `npm root -g` give the two paths):

  ```ini
  [Unit]
  Description=naiwa-server
  After=network-online.target

  [Service]
  User=naiwa
  WorkingDirectory=/home/naiwa
  ExecStart=/usr/bin/node /usr/lib/node_modules/naiwa-server/server/cli.js
  Restart=on-failure

  [Install]
  WantedBy=multi-user.target
  ```

  Then `sudo systemctl enable --now naiwa`, and `journalctl -u naiwa -f` for the log. *(This system
  service wasn't installed here; the same command (`node …/naiwa-server/server/cli.js`, from a local install) ran under
  `systemd-run --user`. Give node's
  full path: a node installed with nvm isn't on systemd's PATH.)*

### Bans and bans.json

- A ban goes by two things: a random id the player's browser keeps, and the address they connect
  from (only the id with `"banAddresses": false`). A join matching either is refused, and the
  player is told they are banned.
- IPv6 addresses are banned by their /64 (devices change the rest by themselves). This machine's
  addresses and those in `trustProxy` are never banned; such a ban goes by browser id alone.
- `bans.json` sits next to `server.json` (`/data/bans.json` in Docker) and is rewritten whole on
  every `ban` and `unban`. Edits by hand take effect at the next start; a file broken by hand stops
  the server with the reason rather than being emptied.
- It's a speed bump, as Minecraft's IP bans are: another network (mobile data, a VPN, a router
  restart) or another browser (a private window, cleared site data) gets them back in, and an
  address many share (a carrier's NAT, a school) bans everyone behind it. A `password` is the real
  gate.

### Firewall and ports

- The server uses TCP only (WebSocket), port 7777 by default; no UDP.
- **With a tunnel** (quick or named): no inbound port at all; 7777 is only for `cloudflared` on the
  same machine.
- **With Caddy:** open TCP 80 and 443 (80 for certificates and redirects), and keep 7777 closed.
  `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp` *(not run here)*. On a cloud VPS also allow
  them in the provider's firewall (security group, Oracle's security list); at home, forward them
  on the router.
- Ports Docker publishes ignore ufw: hence `-p 127.0.0.1:7777:7777`.
- Opening the plain `ws://` port to the internet is no use: browsers on the official site don't
  open `ws://` to anything but this machine.

### Players in mainland China

Cloudflare's tunnels (`trycloudflare.com` too) go through edges outside the mainland, so players
there may see high or unsteady ping. When most players are in the mainland, a nearby VPS (Hong
Kong, Tokyo, Singapore) with Caddy usually plays better. Serving a domain on ports 80/443 from a
server inside the mainland needs an ICP filing. *(Not tested from the mainland.)*

### Machine size

1 vCPU and 512 MB–1 GB of memory: the cheapest VPS, Oracle's free tier, a Raspberry Pi 4/5, or any
home PC. Pick the location by ping to the players. Upload bandwidth matters more than the CPU: up to
about 16 KB/s per player in a busy co-op wave. Measured here with bots (ARM Neoverse-N1, Node 24):

| Mode | Players | CPU (of one core) | Memory | Upload per player | Upload in all (peak) |
| --- | --- | --- | --- | --- | --- |
| co-op, from wave 8 | 4 | 5.3 % | 102–121 MB | 7.5 KB/s mean, 12.5 peak | 0.4 Mbps |
| co-op, from wave 8 | 8 | 8.0 % | 95–122 MB | 10.9 KB/s mean, 16.4 peak | 1.0 Mbps |
| PvP | 4 | 3.7 % | 91–106 MB | 2.3 KB/s mean, 2.8 peak | 0.1 Mbps |
| PvP | 8 | 6.0 % | 92–117 MB | 4.9 KB/s mean, 5.7 peak | 0.4 Mbps |

(3 minutes each, 2026-10-19. With 8 players a tick takes 0.45 ms on average, of the 16.7 ms a
60 Hz step allows.)

