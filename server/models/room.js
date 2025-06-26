const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true },
  users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

module.exports = mongoose.model('Room', roomSchema);