import { Command, Declare, Options } from "seyfert";
import { AddCommand } from "./playlist.add";
import { CreateCommand } from "./playlist.create";
import { DeleteCommand } from "./playlist.delete";
import { ExportCommand } from "./playlist.export";
import { ImportCommand } from "./playlist.import";
import { PlayCommand } from "./playlist.play";
import { RemoveCommand } from "./playlist.remove";
import { ViewCommand } from "./playlist.view";
@Declare({
	name: "playlists",
	description: "Kenium source code on top, im going insane lol",
})
@Options([
	CreateCommand,
	AddCommand,
	RemoveCommand,
	ViewCommand,
	PlayCommand,
	DeleteCommand,
	ExportCommand,
	ImportCommand,
])
export default class Playlists extends Command {}
