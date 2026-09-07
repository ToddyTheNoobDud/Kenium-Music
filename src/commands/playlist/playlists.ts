import { Command, Declare, Options } from 'seyfert'
import { AddCommand } from './playlist.add.ts'
import { CreateCommand } from './playlist.create.ts'
import { DeleteCommand } from './playlist.delete.ts'
import { ExportCommand } from './playlist.export.ts'
import { ImportCommand } from './playlist.import.ts'
import { PlayCommand } from './playlist.play.ts'
import { RemoveCommand } from './playlist.remove.ts'
import { ViewCommand } from './playlist.view.ts'
@Declare({
  name: 'playlists',
  description: 'I can put any description here, inst that cool?'
})
@Options([
  CreateCommand,
  AddCommand,
  RemoveCommand,
  ViewCommand,
  PlayCommand,
  DeleteCommand,
  ExportCommand,
  ImportCommand
])
export default class Playlists extends Command {}
